"""Base protocol for visual perception backends."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

from cookie.models import SessionState, VisualEvent


@runtime_checkable
class VisualPerceptor(Protocol):
    """All visual perception backends implement this interface."""

    def process_frame(self, frame: np.ndarray, session: SessionState) -> list[VisualEvent]: ...

    def capabilities(self) -> set[str]: ...
