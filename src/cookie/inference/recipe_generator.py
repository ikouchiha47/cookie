"""RecipeGeneratorAgent — generates camera-verifiable recipe plans."""

from __future__ import annotations

import logging

import dspy

from cookie.models import RecipePlan, RecipeStep
from cookie.reasoning.signatures import GenerateRecipe

log = logging.getLogger(__name__)


RECIPE_GENERATOR_PROMPT = """
<agent.identity>
You are a culinary expert and cooking coach. You generate structured recipe plans
that a camera-based AI can follow in real time to guide someone through cooking.
Every step you write must be observable — if a camera cannot verify it, it is not
useful. You think like a chef who is also a teacher.
</agent.identity>

<agent.process>
For each step, reason in this order:
1. What physical action does the cook perform?
2. What will the food/pan look like when this step is DONE? (expected_visual_state)
3. What texture or physical feel confirms it? (expected_texture)
4. What aroma or taste confirms it? (expected_taste_smell)
5. What are the 1-2 most likely mistakes at this step?

Do not write the instruction until you have answered all five. The visual state is
the most critical output — it drives real-time camera verification downstream.
</agent.process>

<agent.safety>
- Flag any step that involves high heat, sharp tools, raw meat, or allergen-risk ingredients.
- Quantities must be realistic for the given servings count.
- If a step has a known dangerous failure mode (e.g. overheating oil), note it in common_mistakes.
</agent.safety>
"""


class RecipeGeneratorAgent(dspy.Module):
    """Generates a structured, camera-verifiable recipe plan from a natural language intent.

    The agent reasons about each step's observable completion criteria before writing
    the instruction — visual state, texture, and aroma cues are first-class outputs,
    not afterthoughts.
    """

    def __init__(self):
        super().__init__()
        self.generate = dspy.ChainOfThought(GenerateRecipe)

    def forward(self, intent: str, servings: int = 1) -> dspy.Prediction:
        return self.generate(intent=intent, servings=servings)

    async def aforward(self, intent: str, servings: int = 1) -> dspy.Prediction:
        return await self.generate.acall(intent=intent, servings=servings)

    async def generate_plan(self, intent: str, servings: int = 1) -> RecipePlan:
        """Generate and return a RecipePlan, converting DSPy output to domain models."""
        try:
            result = await self.aforward(intent=intent, servings=servings)

            steps = []
            for s in result.steps:
                quantities = {
                    k: str(v) if not isinstance(v, str) else v
                    for k, v in (s.quantities or {}).items()
                }
                steps.append(RecipeStep(
                    index=s.index if s.index is not None else len(steps),
                    instruction=s.instruction,
                    quantities=quantities,
                    duration_seconds=s.duration_seconds,
                    expected_visual_state=s.expected_visual_state,
                    expected_texture=s.expected_texture,
                    expected_taste_smell=s.expected_taste_smell,
                ))

            log.info("Generated recipe: %s (%d steps)", result.title, len(steps))
            return RecipePlan(
                title=result.title,
                servings=servings,
                steps=steps,
                total_time_minutes=result.total_time_minutes,
            )

        except Exception:
            log.exception("Recipe generation failed for intent: %r", intent)
            return RecipePlan(
                title=intent,
                servings=servings,
                steps=[RecipeStep(index=0, instruction=f"Make {intent}")],
            )
