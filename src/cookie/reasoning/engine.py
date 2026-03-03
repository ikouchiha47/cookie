"""Reasoning engine — decides when to speak and generates guidance via DSPy."""

from __future__ import annotations

import logging
import time
from typing import Any

import dspy

from cookie.models import (
    EventType,
    ReasoningOutput,
    Severity,
    SessionState,
    SpeechEvent,
    SpeechIntent,
    VisualEvent,
)

from .signatures import CookingGuidance, CookingGuidanceTextOnly, GuidanceOutput

log = logging.getLogger(__name__)


class TriggerDecision:
    ALWAYS_SPEAK = "always_speak"
    ALWAYS_SILENT = "always_silent"
    ASK_LLM = "ask_llm"


class ReasoningEngine:
    def __init__(self, lms: dict[str, dspy.LM], config: dict[str, Any] | None = None):
        self.lms = lms
        cfg = config or {}
        self.heartbeat_seconds: int = cfg.get("heartbeat_seconds", 30)
        self.max_context_actions: int = cfg.get("max_context_actions", 3)
        self._last_guidance_time: float = 0.0

        self.guide_vision = dspy.ChainOfThought(CookingGuidance)
        self.guide_text = dspy.ChainOfThought(CookingGuidanceTextOnly)

    def evaluate_trigger(
        self,
        visual_events: list[VisualEvent] | None = None,
        speech_event: SpeechEvent | None = None,
        is_user_interrupt: bool = False,
        session: SessionState | None = None,
    ) -> str:
        """Rule-based: decide whether to speak, stay silent, or ask LLM."""
        if visual_events:
            for ev in visual_events:
                if ev.type == EventType.STATE_CHANGE and ev.confidence > 0.8:
                    if "danger" in str(ev.data).lower() or "burn" in str(ev.data).lower():
                        return TriggerDecision.ALWAYS_SPEAK

        if speech_event and speech_event.intent == SpeechIntent.QUESTION:
            return TriggerDecision.ALWAYS_SPEAK

        if is_user_interrupt:
            return TriggerDecision.ALWAYS_SPEAK

        if time.time() - self._last_guidance_time > self.heartbeat_seconds:
            return TriggerDecision.ASK_LLM

        if visual_events and any(ev.type == EventType.STATE_CHANGE for ev in visual_events):
            return TriggerDecision.ASK_LLM

        if speech_event and speech_event.intent == SpeechIntent.STATEMENT:
            return TriggerDecision.ASK_LLM

        return TriggerDecision.ALWAYS_SILENT

    def generate_guidance(
        self,
        session: SessionState,
        trigger_event: str,
        visual_events: list[VisualEvent] | None = None,
        speech_event: SpeechEvent | None = None,
        image: dspy.Image | None = None,
    ) -> ReasoningOutput:
        """Call LLM via DSPy to generate guidance."""
        recipe_step = ""
        expected = ""
        if session.recipe_plan and session.current_step < len(session.recipe_plan.steps):
            step = session.recipe_plan.steps[session.current_step]
            recipe_step = step.instruction
            expected = step.expected_visual_state

        recent_actions = session.action_log[-self.max_context_actions:]
        actions_text = "; ".join(f"{a.action} ({a.status})" for a in recent_actions) or "none"

        trigger_parts = [trigger_event]
        if visual_events:
            for ev in visual_events[-3:]:
                trigger_parts.append(f"Visual({ev.type.value}): {ev.data}")
        if speech_event:
            trigger_parts.append(f'Speech: "{speech_event.text}"')

        # Pick vision model if we have an image
        lm = self.lms.get("vision") if image else self.lms.get("reasoning")

        try:
            with dspy.context(lm=lm):
                if image:
                    result = self.guide_vision(
                        recipe_step=recipe_step or "N/A",
                        expected_state=expected or "N/A",
                        vessel_state=session.vessel_state.model_dump_json(),
                        recent_actions=actions_text,
                        trigger="\n".join(trigger_parts),
                        image=image,
                    )
                else:
                    result = self.guide_text(
                        recipe_step=recipe_step or "N/A",
                        expected_state=expected or "N/A",
                        vessel_state=session.vessel_state.model_dump_json(),
                        recent_actions=actions_text,
                        trigger="\n".join(trigger_parts),
                    )

            out: GuidanceOutput = result.output
            severity = Severity.INFO
            if out.severity == "warning":
                severity = Severity.WARNING
            elif out.severity == "critical":
                severity = Severity.CRITICAL

            output = ReasoningOutput(
                guidance=out.guidance,
                severity=severity,
                state_updates=out.state_updates,
                step_progress=out.step_progress,
                safety_flag={"level": out.safety_flag.level, "message": out.safety_flag.message}
                if out.safety_flag
                else None,
            )
        except Exception:
            log.exception("Reasoning engine LLM call failed")
            output = ReasoningOutput(guidance="", severity=Severity.INFO)

        self._last_guidance_time = time.time()
        return output
