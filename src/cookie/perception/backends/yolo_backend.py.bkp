"""YOLO-based visual perception backend for fast object detection."""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

from cookie.models import EventType, SessionState, VisualEvent

log = logging.getLogger(__name__)


class YOLOBackend:
    """Fast object detection using YOLOv8."""

    def __init__(self, config: dict[str, Any] | None = None):
        cfg = config or {}
        self.model_name: str = cfg.get("model", "yolov8n.pt")
        self._model = None

    def _ensure_model(self):
        if self._model is not None:
            return
        from ultralytics import YOLO

        self._model = YOLO(self.model_name)
        log.info("YOLO model loaded: %s", self.model_name)

    def process_frame(self, frame: np.ndarray, session: SessionState) -> list[VisualEvent]:
        self._ensure_model()
        results = self._model(frame, verbose=False)
        events = []

        for result in results:
            for box in result.boxes:
                cls_id = int(box.cls[0])
                cls_name = result.names[cls_id]
                conf = float(box.conf[0])
                bbox = box.xyxy[0].tolist()

                events.append(
                    VisualEvent(
                        type=EventType.OBJECT_DETECTED,
                        data={"class": cls_name, "bbox": bbox},
                        confidence=conf,
                        source="yolo",
                    )
                )

        return events

    def capabilities(self) -> set[str]:
        return {"objects", "segmentation"}
