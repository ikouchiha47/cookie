"""Cooking phase inference — observe, guide, track step completion."""

from __future__ import annotations

import io
import logging

import dspy
from PIL import Image

from cookie.models import CookingObservation, GuidanceMessage, SessionContext, Severity, StepUpdate, StepStatus
from cookie.transport.ws_server import ClientSession

log = logging.getLogger(__name__)


async def run_cooking(
    frame: bytes,
    context: SessionContext,
    client: ClientSession,
    lm: dspy.LM,
    observe_sig: dspy.ChainOfThought,
) -> CookingObservation:
    try:
        img = Image.open(io.BytesIO(frame))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=70)
        image = dspy.Image(buf.getvalue())

        with dspy.context(lm=lm):
            result = observe_sig(
                image=image,
                recipe_title=context.recipe_title,
                step_instruction=context.step_instruction,
                expected_visual_state=context.expected_visual_state,
                watch_for=context.watch_for,
            )

        observation = CookingObservation(
            observation=result.observation,
            guidance=result.guidance or "",
            watch_for=result.watch_for_next or "",
            criticality=result.criticality if result.criticality in ("low", "medium", "high") else "medium",
            step_complete=bool(result.step_complete),
            expression=result.expression or "neutral",
        )

        log.info(
            "Cooking [%s] step=%d criticality=%s complete=%s observation=%r",
            client.session_id, context.current_step,
            observation.criticality, observation.step_complete,
            observation.observation[:80],
        )

        # Send observation back to client
        await client.send_cooking_observation(observation)

        # Speak guidance if there is any
        if observation.guidance:
            await client.send_guidance(GuidanceMessage(
                text=observation.guidance,
                severity=Severity.INFO,
                expression=observation.expression,
            ))

        # Signal step complete
        if observation.step_complete:
            await client.send_step_update(StepUpdate(
                step_index=context.current_step,
                status=StepStatus.DONE,
            ))

        return observation

    except Exception:
        log.exception("Cooking inference failed [%s]", client.session_id)
        return CookingObservation(
            observation="", criticality="medium"
        )
