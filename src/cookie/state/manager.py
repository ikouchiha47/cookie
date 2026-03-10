"""Session state manager — maintains world model across cooking session."""

from __future__ import annotations

import logging
import time
from collections import deque
from pathlib import Path

import numpy as np

from cookie.models import (
    ActionLogEntry,
    ReasoningOutput,
    RecipePlan,
    SessionState,
    SpeechEvent,
    TranscriptEntry,
    UserProfile,
    VisualEvent,
)

log = logging.getLogger(__name__)


class SessionManager:
    """Manages session state with hot/warm/cold memory tiers."""

    def __init__(self, session_id: str, storage_dir: str | None = None):
        self.session_id = session_id
        self.state = SessionState()
        self.storage_dir = Path(storage_dir or f"/tmp/cookie_sessions/{session_id}")
        self.storage_dir.mkdir(parents=True, exist_ok=True)

        # Hot memory — last 30s of frames
        self._hot_frames: deque[tuple[float, np.ndarray]] = deque(maxlen=90)  # ~30s at 3fps

        # Warm memory — structured log (in self.state.action_log, transcript_log)
        # Cold memory — frame archive on disk
        self._frame_count = 0

    def set_recipe(self, plan: RecipePlan):
        self.state.recipe_plan = plan
        self.state.intent = plan.title
        self.state.current_step = 0
        log.info("Recipe set: %s (%d steps)", plan.title, len(plan.steps))

    def set_user_profile(self, profile: UserProfile):
        self.state.user_profile = profile

    def add_frame(self, frame: np.ndarray):
        """Store frame in hot memory, periodically flush to cold."""
        now = time.time()
        self._hot_frames.append((now, frame))
        self._frame_count += 1

        # Cold storage: save every 10th frame to disk
        if self._frame_count % 10 == 0:
            self._save_cold_frame(now, frame)

    def get_recent_frames(self, count: int = 3) -> list[np.ndarray]:
        """Get recent frames from hot memory."""
        frames = list(self._hot_frames)
        return [f for _, f in frames[-count:]]

    def add_visual_events(self, events: list[VisualEvent]):
        """Process visual events and update state."""
        for event in events:
            self.state.action_log.append(
                ActionLogEntry(
                    action=f"{event.type.value}: {event.data}",
                    status="observed",
                    notes=f"conf={event.confidence:.2f} src={event.source}",
                )
            )

    def add_speech_event(self, event: SpeechEvent):
        """Record speech in transcript log."""
        self.state.transcript_log.append(
            TranscriptEntry(t=event.t, text=event.text, intent=event.intent)
        )

    def apply_reasoning(self, output: ReasoningOutput):
        """Apply reasoning output to session state."""
        # Apply state updates
        for key, value in output.state_updates.items():
            if hasattr(self.state.vessel_state, key):
                setattr(self.state.vessel_state, key, value)

        # Update ingredients if specified
        if "ingredient_added" in output.state_updates:
            parts = output.state_updates["ingredient_added"].split(":")
            if len(parts) == 2:
                self.state.vessel_state.ingredients[parts[0].strip()] = parts[1].strip()

        # Step progression
        if output.step_progress == "done" and self.state.recipe_plan:
            if self.state.current_step < len(self.state.recipe_plan.steps) - 1:
                self.state.current_step += 1
                log.info("Advanced to step %d", self.state.current_step)

        # Log guidance
        self.state.action_log.append(
            ActionLogEntry(
                action=f"guidance: {output.guidance}",
                status=output.severity.value,
            )
        )

    def _save_cold_frame(self, timestamp: float, frame: np.ndarray):
        """Save frame to disk for post-session review."""
        from PIL import Image

        img = Image.fromarray(frame)
        path = self.storage_dir / f"frame_{timestamp:.3f}.jpg"
        img.save(path, quality=60)

    def save_session(self):
        """Persist session state to disk."""
        path = self.storage_dir / "session_state.json"
        path.write_text(self.state.model_dump_json(indent=2))

    def load_session(self) -> bool:
        """Load session state from disk. Returns True if found."""
        path = self.storage_dir / "session_state.json"
        if path.exists():
            self.state = SessionState.model_validate_json(path.read_text())
            return True
        return False
