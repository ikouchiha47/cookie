"""DSPy signatures for the cooking guide system."""

from typing import Literal

import dspy
from pydantic import BaseModel


# --- Reasoning output schema ---

class RecipeSuggestionOutput(BaseModel):
    name: str
    description: str
    confidence: Literal["high", "medium", "low"] = "medium"


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

    ingredients: list[str] = dspy.OutputField(desc="Ingredients/items visible in the scene")
    suggestions: list[RecipeSuggestionOutput] = dspy.OutputField(
        desc="2-3 recipe suggestions"
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


class ObserveCooking(dspy.Signature):
    """Watch a cooking scene and determine what's happening, what guidance to give,
    and how urgently to check again. Only provide guidance if something needs to be said —
    stay silent during normal progress."""

    image: dspy.Image = dspy.InputField(desc="Current camera frame")
    recipe_title: str = dspy.InputField(desc="Recipe being cooked")
    step_instruction: str = dspy.InputField(desc="Current step the user is on")
    expected_visual_state: str = dspy.InputField(desc="What the camera should show when this step is done")
    watch_for: str = dspy.InputField(desc="Specific visual transition to detect")

    observation: str = dspy.OutputField(desc="Brief description of what you see")
    guidance: str = dspy.OutputField(desc="Guidance to speak aloud — empty string if nothing to say")
    watch_for_next: str = dspy.OutputField(desc="What visual change to watch for next")
    criticality: str = dspy.OutputField(desc="How urgently to check again: low (30s) / medium (10s) / high (3s)")
    step_complete: bool = dspy.OutputField(desc="True if this step appears visually complete")
    expression: str = dspy.OutputField(
        desc="Character expression to show: default / idle / happy / confused / sad / angry / embarrassed / wink / concerned / excited"
    )


class ClassifyVoiceIntent(dspy.Signature):
    """Classify what the user wants based on their speech while cooking.
    They may be giving navigation commands, asking questions, or selecting a recipe."""

    transcript: str = dspy.InputField(desc="What the user said")
    phase: str = dspy.InputField(desc="Current phase: discovery or cooking")
    current_step: int = dspy.InputField(desc="Current recipe step index")

    intent: str = dspy.OutputField(
        desc="One of: next_step, prev_step, repeat_step, select_recipe, "
             "custom_recipe, acknowledge, question, give_up, add_item, wake_word, unknown"
    )
    target: str = dspy.OutputField(
        desc="For select_recipe: recipe name. For question: the question text. Otherwise empty."
    )
    confidence: str = dspy.OutputField(desc="high / medium / low")


class RecipeStepOutput(BaseModel):
    index: int
    instruction: str
    quantities: dict[str, str] = {}
    duration_seconds: int = 0
    expected_visual_state: str = ""
    common_mistakes: list[str] = []


class GenerateRecipe(dspy.Signature):
    """Generate a detailed structured cooking recipe plan."""

    intent: str = dspy.InputField(desc="What the user wants to cook")
    servings: int = dspy.InputField(desc="Number of servings")

    title: str = dspy.OutputField()
    total_time_minutes: int = dspy.OutputField()
    steps: list[RecipeStepOutput] = dspy.OutputField(desc="Ordered list of recipe steps")
