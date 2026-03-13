"""Composite backend: fast model every frame, deep model on state changes."""

from __future__ import annotations

import logging
from typing import Any

import dspy
import numpy as np

from cookie.models import EventType, SessionState, VisualEvent

from .vlm_backend import VLMBackend

log = logging.getLogger(__name__)


class CompositeBackend:
    """Two-tier perception: fast scan + deep reasoning on changes."""

    def __init__(self, lms: dict[str, dspy.LM], config: dict[str, Any] | None = None):
        cfg = config or {}
        self.fast = VLMBackend(lms.get("vision") or lms["reasoning"])
        self.deep = VLMBackend(lms.get("vision") or lms["reasoning"])
        self.deep_on_state_change: bool = cfg.get("deep_on_state_change", True)
        self.uncertainty_threshold: float = cfg.get("deep_on_uncertainty", 0.6)

    def process_frame(self, frame: np.ndarray, session: SessionState) -> list[VisualEvent]:
        fast_events = self.fast.process_frame(frame, session)

        needs_deep = False
        for event in fast_events:
            if event.type == EventType.STATE_CHANGE and self.deep_on_state_change:
                needs_deep = True
                break
            if event.confidence < self.uncertainty_threshold:
                needs_deep = True
                break

        if needs_deep:
            log.info("Triggering deep perception analysis")
            deep_events = self.deep.process_frame(frame, session)
            return fast_events + deep_events

        return fast_events

    def capabilities(self) -> set[str]:
        return {"objects", "state_change", "reasoning", "segmentation"}
