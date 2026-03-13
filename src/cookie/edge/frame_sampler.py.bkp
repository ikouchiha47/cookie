"""Frame sampling with perceptual hashing to skip near-identical frames."""

from __future__ import annotations

import io
import time
from typing import Any

import imagehash
import numpy as np
from PIL import Image


class FrameSampler:
    """Layer 1 scene change detection using perceptual hashing (runs on CPU)."""

    def __init__(self, config: dict[str, Any] | None = None):
        cfg = config or {}
        self.phash_threshold: int = cfg.get("phash_threshold", 12)
        self.min_interval_ms: int = cfg.get("min_interval_ms", 200)
        self._last_hash: imagehash.ImageHash | None = None
        self._last_send_time: float = 0.0

    def should_send(self, frame: np.ndarray) -> tuple[bool, str]:
        """Decide whether a frame is different enough to send.

        Returns (should_send, frame_hash_hex).
        """
        img = Image.fromarray(frame)
        phash = imagehash.phash(img)
        hash_hex = str(phash)

        now = time.time()
        elapsed_ms = (now - self._last_send_time) * 1000

        if elapsed_ms < self.min_interval_ms:
            return False, hash_hex

        if self._last_hash is None:
            self._last_hash = phash
            self._last_send_time = now
            return True, hash_hex

        distance = self._last_hash - phash
        if distance >= self.phash_threshold:
            self._last_hash = phash
            self._last_send_time = now
            return True, hash_hex

        return False, hash_hex

    def encode_jpeg(self, frame: np.ndarray, quality: int = 80) -> bytes:
        """Encode a frame as JPEG bytes."""
        img = Image.fromarray(frame)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        return buf.getvalue()
