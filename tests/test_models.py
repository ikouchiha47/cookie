"""Tests for core data models."""

from cookie.models import (
    Envelope,
    GuidanceMessage,
    RecipePlan,
    RecipeStep,
    Severity,
    SessionContext,
    DiscoveryMessage,
    RecipeSuggestion,
)


def test_envelope_roundtrip():
    msg = GuidanceMessage(text="Keep stirring", severity=Severity.INFO)
    envelope = Envelope(type="guidance", payload=msg.model_dump())
    raw = envelope.model_dump_json()
    restored = Envelope.model_validate_json(raw)
    assert restored.type == "guidance"
    assert restored.payload["text"] == "Keep stirring"


def test_recipe_plan():
    plan = RecipePlan(
        title="Hot Chocolate",
        steps=[
            RecipeStep(
                index=0,
                instruction="Heat milk in a saucepan",
                quantities={"milk": "2 cups"},
                duration_seconds=180,
                expected_visual_state="milk in pot, steam rising",
                expected_texture="warm to touch",
                expected_taste_smell="faint milky aroma",
            ),
            RecipeStep(
                index=1,
                instruction="Add cocoa powder and sugar",
                quantities={"cocoa": "2 tbsp", "sugar": "2 tbsp"},
            ),
        ],
    )
    assert len(plan.steps) == 2
    assert plan.steps[0].quantities["milk"] == "2 cups"
    assert plan.steps[0].expected_texture == "warm to touch"


def test_session_context_defaults():
    ctx = SessionContext()
    assert ctx.phase == "discovery"
    assert ctx.current_step == 0
    assert ctx.recipe_title == ""


def test_discovery_message():
    msg = DiscoveryMessage(
        items=["eggs", "flour", "butter"],
        suggestions=[
            RecipeSuggestion(name="Pancakes", description="Simple breakfast", confidence="high")
        ],
    )
    assert len(msg.items) == 3
    assert msg.suggestions[0].confidence == "high"
