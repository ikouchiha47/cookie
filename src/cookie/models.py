"""Core data models for the cooking guide system."""

from __future__ import annotations

import time
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# --- Enums ---

class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class StepStatus(str, Enum):
    PENDING = "pending"
    ACTIVE = "active"
    DONE = "done"
    SKIPPED = "skipped"


class EventType(str, Enum):
    OBJECT_DETECTED = "object_detected"
    STATE_CHANGE = "state_change"
    COLOR_SHIFT = "color_shift"
    ACTION = "action"


class SpeechIntent(str, Enum):
    QUESTION = "question"
    STATEMENT = "statement"
    CONFIRMATION = "confirmation"


class SceneEventType(str, Enum):
    BOUNDARY = "boundary"
    CONTINUATION = "continuation"


class InterruptType(str, Enum):
    VOICE = "voice"
    BUTTON = "button"


# --- Edge → Server Messages ---

class FrameMessage(BaseModel):
    timestamp: float = Field(default_factory=time.time)
    frame_bytes: bytes
    frame_hash: str


class AudioMessage(BaseModel):
    timestamp: float = Field(default_factory=time.time)
    audio_bytes: bytes
    is_speech: bool = False


class UserInterrupt(BaseModel):
    timestamp: float = Field(default_factory=time.time)
    type: InterruptType
    text: str | None = None


# --- Server → Edge Messages ---

class GuidanceMessage(BaseModel):
    text: str
    severity: Severity = Severity.INFO
    tts_audio_bytes: bytes | None = None


class StepUpdate(BaseModel):
    step_index: int
    status: StepStatus


class QueryMessage(BaseModel):
    question: str
    expects: str = "confirm"  # "confirm" | "freeform"


# --- Perception Events ---

class VisualEvent(BaseModel):
    t: float = Field(default_factory=time.time)
    type: EventType
    data: dict[str, Any] = Field(default_factory=dict)
    confidence: float = 0.0
    source: str = "unknown"


class SpeechEvent(BaseModel):
    t: float = Field(default_factory=time.time)
    text: str
    intent: SpeechIntent | None = None


class SceneEvent(BaseModel):
    t: float = Field(default_factory=time.time)
    type: SceneEventType
    similarity_score: float = 0.0


# --- Recipe Models ---

class SensoryCheckpoint(BaseModel):
    description: str
    camera_verifiable: bool = False


class CommonMistake(BaseModel):
    description: str
    detection: str
    recovery: str


class RecipeStep(BaseModel):
    index: int
    instruction: str
    quantities: dict[str, str] = Field(default_factory=dict)
    duration_seconds: int | None = None
    sensory_checkpoints: list[SensoryCheckpoint] = Field(default_factory=list)
    common_mistakes: list[CommonMistake] = Field(default_factory=list)
    safety_thresholds: dict[str, str] = Field(default_factory=dict)
    expected_visual_state: str = ""


class RecipePlan(BaseModel):
    title: str
    servings: int = 1
    steps: list[RecipeStep] = Field(default_factory=list)
    total_time_minutes: int | None = None


# --- Session State ---

class VesselState(BaseModel):
    ingredients: dict[str, str] = Field(default_factory=dict)
    total_volume: str = ""
    temperature: str = ""
    texture: str = ""
    capacity_left: str = ""


class ActionLogEntry(BaseModel):
    t: float = Field(default_factory=time.time)
    action: str
    status: str = ""
    notes: str = ""


class TranscriptEntry(BaseModel):
    t: float = Field(default_factory=time.time)
    text: str
    intent: SpeechIntent | None = None


class UserProfile(BaseModel):
    allergies: list[str] = Field(default_factory=list)
    conditions: list[str] = Field(default_factory=list)
    household: list[str] = Field(default_factory=list)
    skill_level: str = "beginner"


class SessionState(BaseModel):
    intent: str = ""
    recipe_plan: RecipePlan | None = None
    current_step: int = 0
    vessel_state: VesselState = Field(default_factory=VesselState)
    action_log: list[ActionLogEntry] = Field(default_factory=list)
    transcript_log: list[TranscriptEntry] = Field(default_factory=list)
    available_fixes: dict[str, bool] = Field(default_factory=dict)
    user_profile: UserProfile = Field(default_factory=UserProfile)


# --- Reasoning Output ---

class ReasoningOutput(BaseModel):
    guidance: str = ""
    severity: Severity = Severity.INFO
    state_updates: dict[str, str] = Field(default_factory=dict)
    step_progress: str = "in_progress"
    ask_user: dict[str, str] | None = None
    safety_flag: dict[str, str] | None = None


# --- Config ---

class ModelConfig(BaseModel):
    provider: str
    model: str
    role: str = ""


# --- Transport envelope ---

class Envelope(BaseModel):
    """Wire format wrapping any message type."""
    type: str
    payload: dict[str, Any]
    timestamp: float = Field(default_factory=time.time)
