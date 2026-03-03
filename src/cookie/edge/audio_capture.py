"""Audio capture with voice activity detection."""

from __future__ import annotations

import struct
from typing import Any


class AudioCapture:
    """Captures audio in chunks and detects speech via WebRTC VAD."""

    def __init__(self, config: dict[str, Any] | None = None):
        cfg = config or {}
        self.sample_rate: int = cfg.get("sample_rate", 16000)
        self.chunk_seconds: int = cfg.get("chunk_seconds", 5)
        self.vad_aggressiveness: int = cfg.get("vad_aggressiveness", 2)
        self._vad = None
        self._stream = None

    def _ensure_vad(self):
        if self._vad is None:
            import webrtcvad

            self._vad = webrtcvad.Vad(self.vad_aggressiveness)

    def detect_speech(self, audio_bytes: bytes) -> bool:
        """Check if audio chunk contains speech using VAD.

        Expects 16-bit PCM at self.sample_rate. Checks 30ms frames,
        returns True if >30% of frames contain speech.
        """
        self._ensure_vad()
        frame_duration_ms = 30
        frame_size = int(self.sample_rate * frame_duration_ms / 1000) * 2  # 16-bit = 2 bytes
        speech_frames = 0
        total_frames = 0

        for offset in range(0, len(audio_bytes) - frame_size, frame_size):
            frame = audio_bytes[offset : offset + frame_size]
            total_frames += 1
            if self._vad.is_speech(frame, self.sample_rate):
                speech_frames += 1

        if total_frames == 0:
            return False
        return (speech_frames / total_frames) > 0.3

    def open_stream(self):
        """Open PyAudio input stream (edge devices only)."""
        import pyaudio

        pa = pyaudio.PyAudio()
        self._stream = pa.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=self.sample_rate,
            input=True,
            frames_per_buffer=self.sample_rate * self.chunk_seconds,
        )

    def read_chunk(self) -> bytes:
        """Read one chunk of audio from the stream."""
        if self._stream is None:
            raise RuntimeError("Stream not opened. Call open_stream() first.")
        return self._stream.read(self.sample_rate * self.chunk_seconds, exception_on_overflow=False)

    def close(self):
        if self._stream:
            self._stream.stop_stream()
            self._stream.close()
            self._stream = None
