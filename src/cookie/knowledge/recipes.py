"""Recipe generation via DSPy."""

from __future__ import annotations

import logging
from typing import Any

import dspy

from cookie.models import RecipePlan, RecipeStep
from cookie.reasoning.signatures import GenerateRecipe

log = logging.getLogger(__name__)


class RecipeGenerator:
    def __init__(self, lm: dspy.LM | None = None):
        self.lm = lm
        self.generate_sig = dspy.ChainOfThought(GenerateRecipe)

    def generate(self, intent: str, servings: int = 1) -> RecipePlan:
        """Generate a structured recipe plan from a natural language intent."""
        try:
            with dspy.context(lm=self.lm):
                result = self.generate_sig(intent=intent, servings=servings)

            steps = []
            for s in result.steps:
                raw_qty = s.get("quantities") or {}
                quantities = {
                    k: str(v) if not isinstance(v, str) else v
                    for k, v in raw_qty.items()
                }
                steps.append(RecipeStep(
                    index=s.get("index", len(steps)),
                    instruction=s.get("instruction", ""),
                    quantities=quantities,
                    duration_seconds=s.get("duration_seconds"),
                    expected_visual_state=s.get("expected_visual_state", ""),
                ))

            return RecipePlan(
                title=result.title,
                servings=servings,
                steps=steps,
                total_time_minutes=result.total_time_minutes,
            )
        except Exception:
            log.exception("Failed to generate recipe")
            return RecipePlan(
                title=intent,
                servings=servings,
                steps=[RecipeStep(index=0, instruction=f"Make {intent}")],
            )
