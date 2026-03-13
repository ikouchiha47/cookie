"""Model configuration via DSPy."""

from __future__ import annotations

from typing import Any

import dspy


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
