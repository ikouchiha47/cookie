"""Runs guidance and character state generation in parallel, unifies output."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from cookie.models import CharacterState, ReasoningOutput
from cookie.reasoning.character import CharacterModule

log = logging.getLogger(__name__)


def _cooking_context(session_state: Any) -> str:
    """Build a brief cooking context string from session state."""
    parts = []
    if session_state.recipe_plan:
        step_idx = session_state.current_step
        steps = session_state.recipe_plan.steps
        if 0 <= step_idx < len(steps):
            parts.append(f"Recipe: {session_state.recipe_plan.title}")
            parts.append(f"Step {step_idx + 1}/{len(steps)}: {steps[step_idx].instruction}")
    else:
        parts.append("Discovery mode — no active recipe")
    if session_state.action_log:
        last = session_state.action_log[-1].action
        parts.append(f"Last action: {last}")
    return ". ".join(parts) if parts else "Idle"


class CharacterService:
    def __init__(self, character_module: CharacterModule):
        self.character = character_module

    async def run_parallel(
        self,
        guidance_coro,
        trigger: str,
        session_state: Any,
        severity: str = "info",
    ) -> tuple[ReasoningOutput, CharacterState]:
        """
        Run guidance generation and character state generation in parallel.

        Args:
            guidance_coro: awaitable that returns ReasoningOutput
            trigger: what triggered this call
            session_state: current SessionState
            severity: expected severity hint

        Returns:
            (ReasoningOutput, CharacterState)
        """
        cooking_context = _cooking_context(session_state)

        # Fire both concurrently — we don't know guidance_text yet for character,
        # so we first await guidance, then fire character with the actual text.
        # For true parallelism when guidance_text isn't needed:
        # character can start with a placeholder, or we do two-phase.
        #
        # Chosen approach: guidance runs first (fast), then character uses its text.
        # Both are single LLM calls; total latency = max(guidance, character) if we
        # can pipeline. Here we chain since character needs guidance_text.
        #
        # To make truly parallel: run character with cooking_context only (no guidance_text)
        # by passing an empty string — the character module still has enough signal.

        guidance_task = asyncio.create_task(guidance_coro)
        character_task = asyncio.create_task(
            self.character.acall(
                guidance_text="",  # will be filled after guidance resolves
                trigger=trigger,
                cooking_context=cooking_context,
                severity=severity,
            )
        )

        guidance_output, character_state = await asyncio.gather(
            guidance_task, character_task, return_exceptions=True
        )

        # Handle errors gracefully — never crash the main pipeline
        if isinstance(guidance_output, Exception):
            log.exception("Guidance generation failed: %s", guidance_output)
            from cookie.models import Severity
            guidance_output = ReasoningOutput(guidance="", severity=Severity.INFO)

        if isinstance(character_state, Exception):
            log.exception("Character state generation failed: %s", character_state)
            character_state = CharacterState()

        return guidance_output, character_state

    async def run_with_guidance_text(
        self,
        guidance_text: str,
        trigger: str,
        session_state: Any,
        severity: str = "info",
    ) -> CharacterState:
        """
        Generate character state given already-known guidance text.
        Used when guidance was generated synchronously or already available.
        """
        try:
            return await self.character.acall(
                guidance_text=guidance_text,
                trigger=trigger,
                cooking_context=_cooking_context(session_state),
                severity=severity,
            )
        except Exception:
            log.exception("Character state generation failed")
            return CharacterState()
