"""Model configuration and session routing via DSPy."""

from __future__ import annotations

import logging
from typing import Any

import dspy

from .signatures import RouteSession

log = logging.getLogger(__name__)


class ModelRouter(dict):
    """Dict of role → dspy.LM, constructed from config."""

    def __init__(self, models_config: dict[str, Any]):
        super().__init__()
        for key, model_id in models_config.items():
            if isinstance(model_id, str):
                self[key] = dspy.LM(model_id)
            elif isinstance(model_id, dict):
                provider = model_id.get("provider", "openai")
                model = model_id.get("model", "gpt-4o")
                self[key] = dspy.LM(f"{provider}/{model}")

        if "reasoning" in self:
            dspy.configure(lm=self["reasoning"])


class SessionRouter:
    """Lightweight router that decides discovery vs cooking mode.

    Uses a fast non-reasoning model to classify the session state.
    Falls back to simple rule-based logic if no router model is configured.
    """

    def __init__(self, lms: dict[str, dspy.LM]):
        self.lms = lms
        self._route = dspy.Predict(RouteSession)

    def decide_mode(
        self,
        has_recipe_plan: bool,
        recent_transcript: str = "",
        discovered_items: list[str] | None = None,
    ) -> str:
        """Return 'discovery' or 'cooking'."""
        # Fast rule-based shortcut: if we have a recipe, we're cooking
        if has_recipe_plan:
            return "cooking"

        # If no router LM configured, simple rule: no recipe = discovery
        lm = self.lms.get("router") or self.lms.get("reasoning")
        if not lm:
            return "discovery"

        try:
            with dspy.context(lm=lm):
                result = self._route(
                    has_recipe_plan=has_recipe_plan,
                    recent_transcript=recent_transcript or "(no messages yet)",
                    discovered_items=discovered_items or [],
                )
            mode = result.mode.strip().lower()
            return mode if mode in ("discovery", "cooking") else "discovery"
        except Exception:
            log.exception("Session router failed, defaulting to discovery")
            return "discovery"
