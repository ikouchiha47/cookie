"""Cooking agent tool factory.

Tools are closures — they capture store and client at creation time via DI.
No globals, no tight coupling. Swap store/client in tests with mocks.
"""

from __future__ import annotations

import json
import logging
import time
from typing import TYPE_CHECKING

import dspy

from cookie.models import GuidanceMessage, QueryMessage, Severity, StepStatus, StepUpdate
from cookie.reasoning.signatures import AmendStep, AnswerQuestion, ObserveCooking
from cookie.store.session_db import SessionDB, format_history

if TYPE_CHECKING:
    from cookie.transport.ws_server import ClientSession

log = logging.getLogger(__name__)


def make_cooking_tools(
    session_id: str,
    store: SessionDB,
    client: ClientSession,
    lm: dspy.LM,
) -> list:
    """
    Build the tool list for CookingAgent. Each tool is a closure over
    session_id, store, client, and lm — no globals needed.

    Returns a plain list of callables with dspy-compatible signatures.
    CookingAgent registers these via dspy.ReAct(tools=[...]).
    """

    _observe = dspy.ChainOfThought(ObserveCooking)
    _amend = dspy.ChainOfThought(AmendStep)
    _answer = dspy.ChainOfThought(AnswerQuestion)

    async def observe_frame(
        image: dspy.Image,
        recipe_title: str,
        step_instruction: str,
        expected_visual_state: str,
        expected_texture: str = "",
        expected_taste_smell: str = "",
        watch_for: str = "",
    ) -> str:
        """Observe the current camera frame and return what you see and whether the step is complete."""
        log.info(
            "[%s] observe_frame — recipe=%r step=%r watch_for=%r",
            session_id, recipe_title[:40], step_instruction[:60], watch_for[:40],
        )
        with dspy.context(lm=lm):
            result = await _observe.acall(
                image=image,
                recipe_title=recipe_title,
                step_instruction=step_instruction,
                expected_visual_state=expected_visual_state,
                expected_texture=expected_texture,
                expected_taste_smell=expected_taste_smell,
                watch_for=watch_for,
            )

        # Log observation to store
        await store.enqueue_message(
            session_id=session_id,
            timestamp=time.time(),
            type="guidance",
            role="agent",
            content=result.observation,
            metadata={
                "guidance": result.guidance,
                "criticality": result.criticality,
                "step_complete": result.step_complete,
                "expression": result.expression,
            },
        )

        log.info(
            "[%s] observe_frame result — criticality=%s complete=%s guidance=%r",
            session_id, result.criticality, result.step_complete,
            result.guidance[:60] if result.guidance else "(silent)",
        )

        if result.guidance:
            log.debug("[%s] Sending guidance: %r expression=%s", session_id, result.guidance[:80], result.expression)
            await client.send_guidance(GuidanceMessage(
                text=result.guidance,
                severity=Severity.INFO,
                expression=result.expression,
            ))

        if result.step_complete:
            step_row = await store.get_plan(session_id)
            active = next((r for r in step_row if r["status"] == "active"), None)
            if active:
                await store.upsert_step(
                    session_id=session_id,
                    step_index=active["step_index"],
                    instruction=active["instruction"],
                    expected_visual_state=active["expected_visual_state"],
                    expected_texture=active["expected_texture"],
                    expected_taste_smell=active["expected_taste_smell"],
                    status="done",
                )
                await client.send_step_update(StepUpdate(
                    step_index=active["step_index"],
                    status=StepStatus.DONE,
                ))

        return json.dumps({
            "observation": result.observation,
            "guidance": result.guidance,
            "criticality": result.criticality,
            "step_complete": result.step_complete,
            "watch_for_next": result.watch_for_next,
        })

    async def amend_step(
        interrupt_text: str,
        recipe_title: str,
        current_step_index: int,
        recent_observations: str,
    ) -> str:
        """Amend upcoming recipe steps based on what the user said or did mid-cook."""
        log.info(
            "[%s] amend_step — interrupt=%r step=%d",
            session_id, interrupt_text[:80], current_step_index,
        )
        plan = await store.get_plan(session_id)
        remaining = [
            {
                "index": r["step_index"],
                "instruction": r["instruction"],
                "expected_visual_state": r["expected_visual_state"],
            }
            for r in plan
            if r["step_index"] >= current_step_index and r["status"] not in ("done",)
        ]

        with dspy.context(lm=lm):
            result = await _amend.acall(
                interrupt_text=interrupt_text,
                recipe_title=recipe_title,
                current_step_index=current_step_index,
                remaining_steps_json=json.dumps(remaining),
                recent_observations=recent_observations,
            )

        now = time.time()
        amended = []
        for step in (result.amended_steps or []):
            await store.upsert_step(
                session_id=session_id,
                step_index=step.step_index,
                instruction=step.instruction,
                expected_visual_state=step.expected_visual_state,
                expected_texture=step.expected_texture,
                expected_taste_smell=step.expected_taste_smell,
                status="amended",
                amended_at=now,
            )
            amended.append({
                "step_index": step.step_index,
                "instruction": step.instruction,
                "expected_visual_state": step.expected_visual_state,
                "expected_texture": step.expected_texture,
                "expected_taste_smell": step.expected_taste_smell,
            })

        for idx in (result.skip_step_indices or []):
            row = next((r for r in plan if r["step_index"] == idx), None)
            if row:
                await store.upsert_step(
                    session_id=session_id,
                    step_index=idx,
                    instruction=row["instruction"],
                    expected_visual_state=row["expected_visual_state"],
                    status="skipped",
                    amended_at=now,
                )

        log.info(
            "[%s] amend_step result — amended=%d skipped=%d answer=%r",
            session_id, len(amended),
            len(result.skip_step_indices or []),
            (result.answer or "")[:60],
        )

        if amended:
            log.debug("[%s] Sending plan_update for steps: %s", session_id, [s["step_index"] for s in amended])
            await client.send_plan_update(amended)

        if result.answer:
            await client.send_guidance(GuidanceMessage(
                text=result.answer,
                severity=Severity.INFO,
                expression="default",
            ))

        return json.dumps({
            "amended": len(amended),
            "skipped": len(result.skip_step_indices or []),
            "answer": result.answer,
        })

    async def answer_question(
        question: str,
        recipe_title: str,
        current_step_instruction: str,
        recent_observations: str,
    ) -> str:
        """Answer a mid-cook question from the user without amending the plan."""
        log.info("[%s] answer_question — %r", session_id, question[:80])
        history_rows = await store.fetch_recent_messages(session_id, limit=10)
        history = format_history(history_rows)
        with dspy.context(lm=lm):
            result = await _answer.acall(
                question=question,
                recipe_title=recipe_title,
                current_step_instruction=current_step_instruction,
                recent_observations=recent_observations,
                history=history,
            )

        log.info(
            "[%s] answer_question result — requires_amendment=%s answer=%r",
            session_id, result.requires_amendment, result.answer[:80],
        )
        await client.send_guidance(GuidanceMessage(
            text=result.answer,
            severity=Severity.INFO,
            expression=result.expression,
        ))

        return json.dumps({
            "answer": result.answer,
            "requires_amendment": result.requires_amendment,
        })

    async def ask_user(question: str, expects: str = "freeform") -> str:
        """Send a clarifying question to the user and wait for their response."""
        log.info("[%s] ask_user — %r (expects=%s)", session_id, question[:80], expects)
        await client.send_query(QueryMessage(question=question, expects=expects))
        return json.dumps({"asked": question})

    return [observe_frame, amend_step, answer_question, ask_user]
