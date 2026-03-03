"""DSPy signatures for the cooking guide system."""

from __future__ import annotations

from typing import Literal

import dspy
from pydantic import BaseModel


# --- Reasoning output schema ---

class SafetyFlag(BaseModel):
    level: str  # "warning" | "critical"
    message: str


class GuidanceOutput(BaseModel):
    guidance: str
    severity: str = "info"  # "info" | "warning" | "critical"
    state_updates: dict[str, str] = {}
    step_progress: str = "in_progress"  # "in_progress" | "done" | "error"
    safety_flag: SafetyFlag | None = None


# --- Signatures ---

class CookingGuidance(dspy.Signature):
    """You are a real-time cooking assistant watching a user cook via camera.
    Observe the current frame, consider the recipe step, and provide brief guidance.
    Flag any safety issues immediately. Be concise — user is actively cooking."""

    recipe_step: str = dspy.InputField(desc="Current recipe step instruction")
    expected_state: str = dspy.InputField(desc="What the camera should show at this step")
    vessel_state: str = dspy.InputField(desc="Current state of ingredients in vessel")
    recent_actions: str = dspy.InputField(desc="Last few observed actions")
    trigger: str = dspy.InputField(desc="What triggered this guidance request")
    image: dspy.Image = dspy.InputField(desc="Current camera frame")

    output: GuidanceOutput = dspy.OutputField()


class CookingGuidanceTextOnly(dspy.Signature):
    """You are a real-time cooking assistant guiding a user through a recipe.
    Consider the current state and provide brief guidance.
    Flag any safety issues immediately. Be concise."""

    recipe_step: str = dspy.InputField(desc="Current recipe step instruction")
    expected_state: str = dspy.InputField(desc="What should be happening at this step")
    vessel_state: str = dspy.InputField(desc="Current state of ingredients in vessel")
    recent_actions: str = dspy.InputField(desc="Last few observed actions")
    trigger: str = dspy.InputField(desc="What triggered this guidance request")

    output: GuidanceOutput = dspy.OutputField()


class DescribeFrame(dspy.Signature):
    """Describe what you see in this cooking scene. Focus on:
    ingredients visible, actions being performed, state of food,
    and anything that looks wrong or dangerous."""

    recipe_context: str = dspy.InputField(desc="What the user is supposed to be making")
    image: dspy.Image = dspy.InputField(desc="Current camera frame")

    objects: list[str] = dspy.OutputField(desc="Objects/ingredients visible")
    actions: list[str] = dspy.OutputField(desc="Actions being performed")
    state: str = dspy.OutputField(desc="Overall state of the cooking")
    concerns: list[str] = dspy.OutputField(desc="Any safety concerns or deviations")


class GenerateRecipe(dspy.Signature):
    """Generate a detailed structured cooking recipe plan."""

    intent: str = dspy.InputField(desc="What the user wants to cook")
    servings: int = dspy.InputField(desc="Number of servings")

    title: str = dspy.OutputField()
    total_time_minutes: int = dspy.OutputField()
    steps: list[dict] = dspy.OutputField(
        desc="List of steps, each with: index, instruction, quantities (dict), "
        "duration_seconds, expected_visual_state, common_mistakes (list of strings)"
    )
