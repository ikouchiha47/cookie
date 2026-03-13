"""Tests for session state manager."""

import numpy as np

from cookie.models import (
    ActionLogEntry,
    EventType,
    ReasoningOutput,
    RecipePlan,
    RecipeStep,
    Severity,
    VisualEvent,
)
from cookie.state.manager import SessionManager


def test_session_creation():
    mgr = SessionManager("test-1")
    assert mgr.state.current_step == 0


def test_set_recipe():
    mgr = SessionManager("test-2")
    plan = RecipePlan(
        title="Test Recipe",
        steps=[RecipeStep(index=0, instruction="Step 1")],
    )
    mgr.set_recipe(plan)
    assert mgr.state.intent == "Test Recipe"
    assert mgr.state.current_step == 0


def test_add_frame():
    mgr = SessionManager("test-3")
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    mgr.add_frame(frame)
    recent = mgr.get_recent_frames(1)
    assert len(recent) == 1


def test_apply_reasoning_advances_step():
    mgr = SessionManager("test-4")
    plan = RecipePlan(
        title="Test",
        steps=[
            RecipeStep(index=0, instruction="Step 1"),
            RecipeStep(index=1, instruction="Step 2"),
        ],
    )
    mgr.set_recipe(plan)

    output = ReasoningOutput(
        guidance="Step complete",
        step_progress="done",
    )
    mgr.apply_reasoning(output)
    assert mgr.state.current_step == 1


def test_add_visual_events():
    mgr = SessionManager("test-5")
    events = [
        VisualEvent(type=EventType.OBJECT_DETECTED, data={"class": "spoon"}, confidence=0.9)
    ]
    mgr.add_visual_events(events)
    assert len(mgr.state.action_log) == 1
