"""Tests for core data models."""

from cookie.models import (
    Envelope,
    FrameMessage,
    GuidanceMessage,
    RecipePlan,
    RecipeStep,
    SessionState,
    Severity,
    VesselState,
)


def test_envelope_roundtrip():
    msg = GuidanceMessage(text="Keep stirring", severity=Severity.INFO)
    envelope = Envelope(type="guidance", payload=msg.model_dump())
    raw = envelope.model_dump_json()
    restored = Envelope.model_validate_json(raw)
    assert restored.type == "guidance"
    assert restored.payload["text"] == "Keep stirring"


def test_session_state_defaults():
    state = SessionState()
    assert state.current_step == 0
    assert state.vessel_state.ingredients == {}
    assert state.action_log == []


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


def test_vessel_state():
    vs = VesselState(
        ingredients={"milk": "2 cups", "cocoa": "2 tbsp"},
        total_volume="~500ml",
        temperature="hot",
    )
    assert vs.ingredients["milk"] == "2 cups"
