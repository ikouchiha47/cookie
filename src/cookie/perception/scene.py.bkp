"""Layer 2 scene change detection using CLIP embeddings (runs on server)."""

from __future__ import annotations

import logging
from collections import deque
from typing import Any

import numpy as np

from cookie.models import SceneEvent, SceneEventType

log = logging.getLogger(__name__)


class SceneDetector:
    """CLIP/SigLIP-based semantic scene change detection."""

    def __init__(self, config: dict[str, Any] | None = None):
        cfg = config or {}
        self.model_name: str = cfg.get("model", "ViT-B/32")
        self.similarity_threshold: float = cfg.get("similarity_threshold", 0.85)
        self.history_size: int = cfg.get("embedding_history", 10)
        self._embeddings: deque[np.ndarray] = deque(maxlen=self.history_size)
        self._model = None
        self._preprocess = None

    def _ensure_model(self):
        if self._model is not None:
            return
        try:
            import clip
            import torch

            self._device = "cuda" if torch.cuda.is_available() else "cpu"
            self._model, self._preprocess = clip.load(self.model_name, device=self._device)
            log.info("CLIP model loaded: %s on %s", self.model_name, self._device)
        except ImportError:
            log.warning("CLIP not available, scene detection disabled")

    def embed_frame(self, frame: np.ndarray) -> np.ndarray | None:
        """Get CLIP embedding for a frame."""
        self._ensure_model()
        if self._model is None:
            return None

        import torch
        from PIL import Image

        img = Image.fromarray(frame)
        img_input = self._preprocess(img).unsqueeze(0).to(self._device)

        with torch.no_grad():
            embedding = self._model.encode_image(img_input)
            embedding = embedding / embedding.norm(dim=-1, keepdim=True)

        return embedding.cpu().numpy().flatten()

    def detect_change(self, frame: np.ndarray) -> SceneEvent:
        """Check if frame represents a semantic scene change."""
        embedding = self.embed_frame(frame)
        if embedding is None:
            return SceneEvent(type=SceneEventType.CONTINUATION, similarity_score=1.0)

        if not self._embeddings:
            self._embeddings.append(embedding)
            return SceneEvent(type=SceneEventType.BOUNDARY, similarity_score=0.0)

        last = self._embeddings[-1]
        similarity = float(np.dot(embedding, last))
        self._embeddings.append(embedding)

        if similarity < self.similarity_threshold:
            return SceneEvent(type=SceneEventType.BOUNDARY, similarity_score=similarity)
        return SceneEvent(type=SceneEventType.CONTINUATION, similarity_score=similarity)

    def find_similar(self, query_embedding: np.ndarray, top_k: int = 3) -> list[int]:
        """Find indices of most similar frames in history (for retrieval)."""
        if not self._embeddings:
            return []
        sims = [float(np.dot(query_embedding, e)) for e in self._embeddings]
        ranked = sorted(range(len(sims)), key=lambda i: sims[i], reverse=True)
        return ranked[:top_k]
