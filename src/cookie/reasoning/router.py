"""Model configuration via DSPy."""

from __future__ import annotations

from typing import Any

import dspy


def configure_models(models_config: dict[str, Any]) -> dict[str, dspy.LM]:
    """Create dspy.LM instances from config. Returns dict keyed by role."""
    lms: dict[str, dspy.LM] = {}
    for key, model_id in models_config.items():
        if isinstance(model_id, str):
            lms[key] = dspy.LM(model_id)
        elif isinstance(model_id, dict):
            # Legacy format support
            provider = model_id.get("provider", "openai")
            model = model_id.get("model", "gpt-4o")
            lms[key] = dspy.LM(f"{provider}/{model}")

    # Set the reasoning model as default
    if "reasoning" in lms:
        dspy.configure(lm=lms["reasoning"])

    return lms
