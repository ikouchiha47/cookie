"""Character state generation — runs in parallel with guidance."""

from __future__ import annotations

from typing import Literal

import dspy
from pydantic import BaseModel, field_validator

from cookie.models import CharacterState
from cookie.reasoning.router import ModelRouter


# --- DSPy signature ---

class CharacterStateOutput(BaseModel):
    expression: Literal["happy", "thinking", "concerned", "alert", "sleeping", "neutral"] = "neutral"
    antenna_light: Literal["idle", "thinking", "alert", "error"] = "idle"
    emotion: Literal["excited", "focused", "worried", "confused", "neutral"] = "neutral"
    arm_pose: Literal["neutral", "pointing", "wave", "celebrate"] = "neutral"
    arm_left_rotation: float = 0
    arm_right_rotation: float = 0

    @field_validator("arm_left_rotation", "arm_right_rotation")
    @classmethod
    def clamp_rotation(cls, v: float) -> float:
        return max(-30.0, min(30.0, v))


class CharacterStateSignature(dspy.Signature):
    """You control the physical and emotional state of a small friendly cooking robot called Cookie.
    Cookie has a square-ish body, two glowing eyes on a dark screen, a small mouth, an antenna
    with a light, and two arms.

    Based on what's happening in the cooking session, decide how Cookie should look and feel.
    Make Cookie feel alive and reactive — use the full range of expressions and poses.

    Arm rotation is in degrees: 0 = hanging naturally, positive = raised, negative = lowered.
    Max ±30 degrees. Use stop-motion style discrete poses rather than subtle tweaks.

    Antenna light reflects processing state: idle when listening, thinking when computing,
    alert for safety warnings, error for failures.
    """

    guidance_text: str = dspy.InputField(desc="The guidance text being sent to the user")
    trigger: str = dspy.InputField(desc="What triggered this: frame, user_speech, user_interrupt, chat")
    cooking_context: str = dspy.InputField(desc="Brief summary of what's happening in the session")
    severity: str = dspy.InputField(desc="Current severity level: info, warning, critical")

    state: CharacterStateOutput = dspy.OutputField()


# --- Module ---

class CharacterModule(dspy.Module):
    def __init__(self, router: ModelRouter):
        super().__init__()
        self.router = router
        self._generate = dspy.ChainOfThought(CharacterStateSignature)

    def forward(
        self,
        guidance_text: str,
        trigger: str,
        cooking_context: str,
        severity: str = "info",
    ) -> CharacterState:
        lm = self.router.get("reasoning")
        with dspy.context(lm=lm):
            result = self._generate(
                guidance_text=guidance_text,
                trigger=trigger,
                cooking_context=cooking_context,
                severity=severity,
            )
        s = result.state
        return CharacterState(
            expression=s.expression,
            antenna_light=s.antenna_light,
            emotion=s.emotion,
            arm_pose=s.arm_pose,
            arm_left_rotation=s.arm_left_rotation,
            arm_right_rotation=s.arm_right_rotation,
        )

    async def aforward(
        self,
        guidance_text: str,
        trigger: str,
        cooking_context: str,
        severity: str = "info",
    ) -> CharacterState:
        lm = self.router.get("reasoning")
        with dspy.context(lm=lm):
            result = await self._generate.acall(
                guidance_text=guidance_text,
                trigger=trigger,
                cooking_context=cooking_context,
                severity=severity,
            )
        s = result.state
        return CharacterState(
            expression=s.expression,
            antenna_light=s.antenna_light,
            emotion=s.emotion,
            arm_pose=s.arm_pose,
            arm_left_rotation=s.arm_left_rotation,
            arm_right_rotation=s.arm_right_rotation,
        )
