"""Main server — orchestrates perception, reasoning, and state management."""

from __future__ import annotations

import asyncio
import base64
import io
import logging
from typing import Any

import numpy as np
from PIL import Image

from cookie.config import load_config
from cookie.knowledge.recipes import RecipeGenerator
from cookie.knowledge.safety import SafetyChecker
from cookie.models import (
    AudioMessage,
    FrameMessage,
    GuidanceMessage,
    Severity,
    StepUpdate,
    UserInterrupt,
)
from cookie.perception.engine import PerceptionEngine
from cookie.reasoning.engine import ReasoningEngine, TriggerDecision
from cookie.reasoning.router import ModelRouter
from cookie.state.manager import SessionManager
from cookie.transport.ws_server import ClientSession, TransportServer

log = logging.getLogger(__name__)


class CookingServer:
    """Main server orchestrating the cooking guidance pipeline."""

    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or load_config()
        server_cfg = self.config.get("server", {})

        self.router = ModelRouter(self.config.get("models", {}))
        self.perception = PerceptionEngine(self.router, self.config)
        self.reasoning = ReasoningEngine(self.router, self.config.get("reasoning", {}))
        self.safety = SafetyChecker()
        self.recipe_gen = RecipeGenerator(self.router)

        self.transport = TransportServer(
            host=server_cfg.get("host", "0.0.0.0"),
            port=server_cfg.get("port", 8420),
        )

        # Session per client
        self._sessions: dict[str, SessionManager] = {}

        # Register message handlers
        self.transport.on_message("frame", self._handle_frame)
        self.transport.on_message("audio", self._handle_audio)
        self.transport.on_message("interrupt", self._handle_interrupt)

    def _get_session(self, client: ClientSession) -> SessionManager:
        if client.session_id not in self._sessions:
            self._sessions[client.session_id] = SessionManager(client.session_id)
        return self._sessions[client.session_id]

    async def _handle_frame(self, msg_type: str, payload: dict, client: ClientSession):
        session_mgr = self._get_session(client)
        frame_msg = FrameMessage(**payload)

        # Decode JPEG frame
        img = Image.open(io.BytesIO(frame_msg.frame_bytes)).convert("RGB")
        frame = np.array(img)
        session_mgr.add_frame(frame)

        # Run perception
        visual_events, is_boundary = self.perception.process_frame(frame, session_mgr.state)
        session_mgr.add_visual_events(visual_events)

        # Check safety on detected objects/actions
        for event in visual_events:
            self._check_safety(event.data, session_mgr, client)

        # Evaluate trigger
        trigger = self.reasoning.evaluate_trigger(
            visual_events=visual_events, session=session_mgr.state
        )

        if trigger != TriggerDecision.ALWAYS_SILENT:
            # Get keyframes for vision-capable reasoning
            recent = session_mgr.get_recent_frames(self.reasoning.max_keyframes)
            keyframes_b64 = []
            for f in recent:
                buf = io.BytesIO()
                Image.fromarray(f).save(buf, format="JPEG", quality=70)
                keyframes_b64.append(base64.b64encode(buf.getvalue()).decode())

            output = self.reasoning.generate_guidance(
                session=session_mgr.state,
                trigger_event=f"frame (boundary={is_boundary})",
                visual_events=visual_events,
                keyframe_b64s=keyframes_b64,
            )
            session_mgr.apply_reasoning(output)

            if output.guidance:
                await client.send_guidance(
                    GuidanceMessage(text=output.guidance, severity=output.severity)
                )

            if output.step_progress == "done":
                await client.send_step_update(
                    StepUpdate(
                        step_index=session_mgr.state.current_step,
                        status="active",
                    )
                )

    async def _handle_audio(self, msg_type: str, payload: dict, client: ClientSession):
        session_mgr = self._get_session(client)
        audio_msg = AudioMessage(**payload)

        speech_event = self.perception.process_audio(audio_msg.audio_bytes)
        if not speech_event:
            return

        session_mgr.add_speech_event(speech_event)

        trigger = self.reasoning.evaluate_trigger(
            speech_event=speech_event, session=session_mgr.state
        )

        if trigger != TriggerDecision.ALWAYS_SILENT:
            output = self.reasoning.generate_guidance(
                session=session_mgr.state,
                trigger_event="user_speech",
                speech_event=speech_event,
            )
            session_mgr.apply_reasoning(output)

            if output.guidance:
                await client.send_guidance(
                    GuidanceMessage(text=output.guidance, severity=output.severity)
                )

    async def _handle_interrupt(self, msg_type: str, payload: dict, client: ClientSession):
        session_mgr = self._get_session(client)
        interrupt = UserInterrupt(**payload)

        output = self.reasoning.generate_guidance(
            session=session_mgr.state,
            trigger_event=f"user_interrupt ({interrupt.type.value})",
        )
        session_mgr.apply_reasoning(output)

        if output.guidance:
            await client.send_guidance(
                GuidanceMessage(text=output.guidance, severity=output.severity)
            )

    def _check_safety(self, data: dict, session_mgr: SessionManager, client: ClientSession):
        """Run safety checks on detected data."""
        profile = session_mgr.state.user_profile
        for key, val in data.items():
            if key in ("class", "description", "ingredient"):
                ingredient = str(val)
                allergen_warn = self.safety.check_allergens(ingredient, profile)
                if allergen_warn:
                    log.warning("ALLERGEN: %s", allergen_warn)
                household_warn = self.safety.check_household(ingredient, profile)
                if household_warn:
                    log.warning("HOUSEHOLD SAFETY: %s", household_warn)

    async def start(self):
        await self.transport.start()
        log.info("Cooking server started")

    async def run_forever(self):
        await self.start()
        await asyncio.Future()  # run until cancelled

    async def stop(self):
        for mgr in self._sessions.values():
            mgr.save_session()
        await self.transport.stop()


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Cookie cooking guide server")
    parser.add_argument("--config", help="Path to config YAML")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    config = load_config(args.config)
    server = CookingServer(config)
    asyncio.run(server.run_forever())


if __name__ == "__main__":
    main()
