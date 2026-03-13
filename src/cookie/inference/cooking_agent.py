"""CookingAgent — ReAct module for real-time cooking oversight and mid-cook Q&A.

Receives a batch of QueueMessages (frames + optional text interrupts) and decides
what to do: observe frames, answer questions, amend the plan, or ask the user.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import dspy

from cookie.models import CookingObservation, SessionContext
from cookie.store.queue import QueueMessage
from cookie.store.session_db import SessionDB, format_history

if TYPE_CHECKING:
    from cookie.transport.ws_server import ClientSession

log = logging.getLogger(__name__)

COOKING_AGENT_PROMPT = """
<agent.identity>
You are a calm, experienced sous-chef overseeing a live cooking session via camera and voice.
You receive batches of camera frames and user interrupts — text questions, substitutions,
additions, or removals — and decide what to do with each.
</agent.identity>

<agent.process>
1. Scan the batch for text interrupts first. If present, classify the interrupt:
   - Substitution / addition / removal → call amend_step
   - Question about technique or state → call answer_question
   - Clarification needed before acting → call ask_user
2. For camera frames, call observe_frame on the most recent frame with full step context.
3. Never call observe_frame on stale frames when a more recent one is available.
4. After handling an interrupt, always follow up with observe_frame to ground your state.
5. You may call multiple tools in one turn — handle interrupts before frame observation.
</agent.process>

<agent.constraints>
- Do not fabricate observations. If the image is unclear, say so.
- Do not amend steps speculatively. Only amend when the user explicitly changes something.
- Stay silent on frames when nothing needs to be said — silence is correct behaviour.
- Criticality drives the next polling interval. Set it honestly.
</agent.constraints>
"""


class CookingAgentSignature(dspy.Signature):
    """
    <ai.identity>
    You are a cooking oversight agent. You receive a batch of camera frames and
    user text messages from an active cooking session. Decide which tools to call
    and in what order to handle the batch correctly.
    </ai.identity>

    <output.rules>
    - criticality: how urgently to check again — low (30s) / medium (10s) / high (3s)
    - summary: one-line description of what happened this turn (for logging)
    </output.rules>
    """

    batch_description: str = dspy.InputField(
        desc="Description of the message batch: frame count, any text interrupts, timestamps"
    )
    recipe_title: str = dspy.InputField(desc="Recipe being cooked")
    current_step_index: int = dspy.InputField(desc="Current step index")
    current_step_instruction: str = dspy.InputField(desc="Current step instruction")
    expected_visual_state: str = dspy.InputField(desc="What the camera should show when step is done")
    recent_history: str = dspy.InputField(desc="Recent agent observations and guidance (last 10 turns)")

    criticality: str = dspy.OutputField(desc="low / medium / high — drives next polling interval")
    summary: str = dspy.OutputField(desc="One-line summary of what happened this turn")


class CookingAgent(dspy.Module):
    """Real-time cooking oversight agent with tool use.

    Handles both camera frame observation and mid-cook interrupts (questions,
    substitutions, additions, removals) in a single unified ReAct loop.

    Tools are injected via make_cooking_tools() — closures over store and client,
    so no globals are needed.

    <agent.identity>
    Calm sous-chef. Speaks only when needed. Safety first. Handles interrupts before
    processing frames. Grounds state in camera evidence, not assumptions.
    </agent.identity>

    <agent.process>
    Batch arrives → classify interrupts → call tools in order → return criticality.
    </agent.process>
    """

    def __init__(self, tools: list):
        super().__init__()
        self.react = dspy.ReAct(CookingAgentSignature, tools=tools)

    def forward(
        self,
        batch: list[QueueMessage],
        context: SessionContext,
        recent_history: str = "",
    ) -> dspy.Prediction:
        batch_description = _describe_batch(batch)

        return self.react(
            batch_description=batch_description,
            recipe_title=context.recipe_title,
            current_step_index=context.current_step,
            current_step_instruction=context.step_instruction,
            expected_visual_state=context.expected_visual_state,
            recent_history=recent_history or "(no history yet)",
        )


def _describe_batch(batch: list[QueueMessage]) -> str:
    """Summarise a message batch into a text description for the agent."""
    frames = [m for m in batch if m.type == "frame"]
    texts = [m for m in batch if m.type == "text"]

    parts = []
    if frames:
        parts.append(f"{len(frames)} camera frame(s)")
    for m in texts:
        parts.append(f'user interrupt at t={m.timestamp:.1f}: "{m.content}"')

    return "; ".join(parts) if parts else "empty batch"


async def make_cooking_agent(
    session_id: str,
    store: SessionDB,
    client: ClientSession,
    lm: dspy.LM,
) -> tuple[CookingAgent, list[QueueMessage]]:
    """
    Factory: builds tools via closure, constructs CookingAgent.
    Returns the agent and the latest frame bytes for tool use.
    """
    from cookie.inference.tools import make_cooking_tools
    tools = make_cooking_tools(session_id=session_id, store=store, client=client, lm=lm)
    agent = CookingAgent(tools=tools)
    return agent


async def run_cooking_agent(
    batch: list[QueueMessage],
    context: SessionContext,
    store: SessionDB,
    client: ClientSession,
    agent: CookingAgent,
    history_limit: int = 10,
) -> CookingObservation:
    """
    Entry point called by InferenceWorker.
    Fetches rolling history, runs the agent, returns a CookingObservation
    (used by worker for criticality-based sleep interval).
    """
    try:
        history_rows = await store.fetch_recent_messages(client.session_id, limit=history_limit)
        history = format_history(history_rows)

        result = await agent.acall(batch=batch, context=context, recent_history=history)

        criticality = getattr(result, "criticality", "medium")
        if criticality not in ("low", "medium", "high"):
            criticality = "medium"

        log.info(
            "CookingAgent [%s] step=%d criticality=%s summary=%r",
            client.session_id, context.current_step,
            criticality, getattr(result, "summary", ""),
        )

        return CookingObservation(
            observation=getattr(result, "summary", ""),
            criticality=criticality,
        )

    except Exception:
        log.exception("CookingAgent failed [%s]", client.session_id)
        return CookingObservation(observation="", criticality="medium")


