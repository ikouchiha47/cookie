"""DSPy signatures for the cooking guide system."""

from __future__ import annotations

from typing import Literal

import dspy
from pydantic import BaseModel


# --- Reasoning output schema ---

class SafetyFlag(BaseModel):
    level: Literal["warning", "critical"]
    message: str


class GuidanceOutput(BaseModel):
    guidance: str
    severity: Literal["info", "warning", "critical"] = "info"
    expression: Literal[
        "default", "idle", "happy", "confused", "sad",
        "angry", "embarrassed", "wink", "concerned", "excited",
        "other"  # fallback — app treats "other" as "default"
    ] = "default"
    state_updates: dict[str, str] = {}
    step_progress: Literal["in_progress", "done", "error"] = "in_progress"
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


class DiscoverIngredients(dspy.Signature):
    """You are looking at a kitchen scene through a camera. Identify all visible
    ingredients and items, then suggest 2-3 recipes the user could make with them.
    Be practical — only list what you can actually see."""

    image: dspy.Image = dspy.InputField(desc="Current camera frame")
    user_hint: str = dspy.InputField(
        desc="Optional user message like 'I want to make pasta'", default=""
    )

    items: list[str] = dspy.OutputField(desc="Ingredients/items visible in the scene")
    suggestions: list[dict] = dspy.OutputField(
        desc="2-3 recipe suggestions, each with: name, description, confidence (high/medium/low)"
    )


class RouteSession(dspy.Signature):
    """Decide the current session mode based on conversation history and state.
    Return 'discovery' when the user has no active recipe and is exploring,
    or 'cooking' when they have selected a recipe and are following steps."""

    has_recipe_plan: bool = dspy.InputField(desc="Whether a recipe plan is currently active")
    recent_transcript: str = dspy.InputField(desc="Last few user/system messages")
    discovered_items: list[str] = dspy.InputField(desc="Items found so far via discovery")

    mode: str = dspy.OutputField(desc="'discovery' or 'cooking'")
    reason: str = dspy.OutputField(desc="Brief reason for the routing decision")


class RecipeSuggestionOutput(BaseModel):
    name: str
    description: str
    confidence: Literal["high", "medium", "low"] = "medium"


class ChatWithKitchen(dspy.Signature):
    """You are a cooking assistant chatting with a user. They may send one or more
    images of their kitchen, ingredients, or dishes. Respond helpfully — identify
    what you see across all images, answer questions, suggest recipes, or give
    cooking advice. Keep it conversational and concise."""

    message: str = dspy.InputField(desc="User's chat message")
    images: list[dspy.Image] = dspy.InputField(desc="Images from user (may be empty)")
    history: str = dspy.InputField(desc="Recent conversation history")

    reply: str = dspy.OutputField(desc="Your response to the user")
    items: list[str] = dspy.OutputField(desc="Ingredients/items identified across all images")
    suggestions: list[RecipeSuggestionOutput] = dspy.OutputField(desc="Recipe suggestions if relevant")


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
