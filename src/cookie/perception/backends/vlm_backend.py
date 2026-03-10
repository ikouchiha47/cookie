"""Vision-language model backend via DSPy."""

from __future__ import annotations

import logging

import dspy
import numpy as np

from cookie.models import EventType, SessionState, VisualEvent
from cookie.reasoning.signatures import DescribeFrame

log = logging.getLogger(__name__)


class VLMBackend:
    """Vision-language model backend using DSPy signatures."""

    def __init__(self, lm: dspy.LM):
        self.lm = lm
        self.describe = dspy.Predict(DescribeFrame)

    def process_frame(self, frame: np.ndarray, session: SessionState) -> list[VisualEvent]:
        recipe_context = ""
        if session.recipe_plan:
            recipe_context = session.recipe_plan.title
            if session.current_step < len(session.recipe_plan.steps):
                recipe_context += f" — step: {session.recipe_plan.steps[session.current_step].instruction}"

        # Save frame to temp file for dspy.Image
        import tempfile
        from PIL import Image

        img = Image.fromarray(frame)
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        img.save(tmp.name, quality=70)

        try:
            with dspy.context(lm=self.lm):
                result = self.describe(
                    recipe_context=recipe_context or "cooking",
                    image=dspy.Image.from_file(tmp.name),
                )
        except Exception:
            log.exception("VLM frame description failed")
            return []

        events = []
        for obj in result.objects:
            events.append(VisualEvent(
                type=EventType.OBJECT_DETECTED,
                data={"description": obj},
                confidence=0.7,
                source="vlm",
            ))
        for action in result.actions:
            events.append(VisualEvent(
                type=EventType.ACTION,
                data={"description": action},
                confidence=0.7,
                source="vlm",
            ))
        for concern in result.concerns:
            events.append(VisualEvent(
                type=EventType.STATE_CHANGE,
                data={"concern": concern},
                confidence=0.8,
                source="vlm",
            ))
        return events

    def capabilities(self) -> set[str]:
        return {"objects", "state_change", "reasoning"}
