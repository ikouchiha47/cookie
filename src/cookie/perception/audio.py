"""Audio perception — speech-to-text via Whisper."""

from __future__ import annotations

import logging
from typing import Any

from cookie.models import SpeechEvent, SpeechIntent

log = logging.getLogger(__name__)


class AudioPerceptor:
    """Transcribes audio using faster-whisper (local) or ollama whisper."""

    def __init__(self, config: dict[str, Any] | None = None):
        cfg = config or {}
        self.provider: str = cfg.get("provider", "faster-whisper")
        self.model_name: str = cfg.get("model", "base")
        self._model = None

    def _ensure_model(self):
        if self._model is not None:
            return
        if self.provider == "faster-whisper":
            from faster_whisper import WhisperModel

            self._model = WhisperModel(self.model_name, compute_type="int8")
            log.info("Whisper model loaded: %s", self.model_name)

    def transcribe(self, audio_bytes: bytes, sample_rate: int = 16000) -> SpeechEvent | None:
        """Transcribe audio bytes to text."""
        self._ensure_model()

        if self.provider == "faster-whisper":
            return self._transcribe_faster_whisper(audio_bytes)

        return None

    def _transcribe_faster_whisper(self, audio_bytes: bytes) -> SpeechEvent | None:
        import io
        import tempfile

        import numpy as np

        # Convert raw PCM to float32
        audio_array = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        segments, info = self._model.transcribe(audio_array, beam_size=5)
        text = " ".join(seg.text for seg in segments).strip()

        if not text:
            return None

        intent = self._classify_intent(text)
        return SpeechEvent(text=text, intent=intent)

    def _classify_intent(self, text: str) -> SpeechIntent:
        """Simple heuristic intent classification."""
        text_lower = text.lower().strip()
        if text_lower.endswith("?") or text_lower.startswith(
            ("what", "how", "when", "where", "why", "is", "are", "can", "should", "do")
        ):
            return SpeechIntent.QUESTION
        if text_lower.startswith(("yes", "yeah", "ok", "sure", "right", "correct", "no", "nope")):
            return SpeechIntent.CONFIRMATION
        return SpeechIntent.STATEMENT
