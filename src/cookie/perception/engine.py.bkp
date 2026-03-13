"""Perception engine — dispatches to visual + audio backends."""

from __future__ import annotations

import logging
from typing import Any

import dspy
import numpy as np

from cookie.models import SessionState, SpeechEvent, VisualEvent

from .audio import AudioPerceptor
from .backends.composite_backend import CompositeBackend
from .backends.vlm_backend import VLMBackend
from .backends.yolo_backend import YOLOBackend
from .scene import SceneDetector

log = logging.getLogger(__name__)


def create_visual_backend(backend_name: str, lms: dict[str, dspy.LM], config: dict[str, Any]):
    if backend_name == "yolo":
        return YOLOBackend(config)
    elif backend_name == "composite":
        return CompositeBackend(lms, config.get("composite", {}))
    else:
        return VLMBackend(lms.get("vision") or lms["reasoning"])


class PerceptionEngine:
    """Processes raw frames + audio into structured events."""

    def __init__(self, lms: dict[str, dspy.LM], config: dict[str, Any] | None = None):
        cfg = config or {}
        perception_cfg = cfg.get("perception", {})
        backend_name = perception_cfg.get("backend", "vlm")

        self.visual = create_visual_backend(backend_name, lms, perception_cfg)
        self.scene_detector = SceneDetector(perception_cfg.get("clip", {}))
        self.audio_perceptor = AudioPerceptor(cfg.get("models", {}).get("stt", {}))

    def process_frame(
        self, frame: np.ndarray, session: SessionState
    ) -> tuple[list[VisualEvent], bool]:
        scene_event = self.scene_detector.detect_change(frame)
        is_boundary = scene_event.type.value == "boundary"
        events = self.visual.process_frame(frame, session)
        return events, is_boundary

    def process_audio(self, audio_bytes: bytes) -> SpeechEvent | None:
        return self.audio_perceptor.transcribe(audio_bytes)
