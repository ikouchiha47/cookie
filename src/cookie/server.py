"""Main server — orchestrates perception, reasoning, and state management."""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import time
from typing import Any

import dspy
import numpy as np
from PIL import Image

from cookie.config import load_config
from cookie.history import HistoryManager
from cookie.knowledge.recipes import RecipeGenerator
from cookie.knowledge.safety import SafetyChecker
from cookie.models import (
    AudioMessage,
    ChatMessage,
    ChatResponse,
    DiscoveryMessage,
    FrameMessage,
    GuidanceMessage,
    RecipeSuggestion,
    Severity,
    StepUpdate,
    UserInterrupt,
)
from cookie.perception.engine import PerceptionEngine
from cookie.reasoning.character import CharacterModule
from cookie.reasoning.character_service import CharacterService
from cookie.reasoning.engine import ReasoningEngine, TriggerDecision
from cookie.reasoning.router import ModelRouter, SessionRouter
from cookie.reasoning.signatures import ChatWithKitchen, DiscoverIngredients
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

        self.session_router = SessionRouter(self.router)
        self._discover = dspy.ChainOfThought(DiscoverIngredients)
        self._chat = dspy.ChainOfThought(ChatWithKitchen)
        self._history = HistoryManager(max_turns=40)

        self.character_module = CharacterModule(self.router)
        self.character_service = CharacterService(self.character_module)

        self.transport = TransportServer(
            host=server_cfg.get("host", "0.0.0.0"),
            port=server_cfg.get("port", 8420),
        )

        # Session per client
        self._sessions: dict[str, SessionManager] = {}
        self._last_discovery_time: dict[str, float] = {}
        _DISCOVERY_COOLDOWN = 5.0  # seconds between discovery calls

        # Register message handlers
        self.transport.on_message("frame", self._handle_frame)
        self.transport.on_message("audio", self._handle_audio)
        self.transport.on_message("interrupt", self._handle_interrupt)
        self.transport.on_message("chat", self._handle_chat)

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

        # --- Discovery mode: no recipe plan yet ---
        if session_mgr.state.recipe_plan is None:
            now = time.time()
            last = self._last_discovery_time.get(client.session_id, 0.0)
            if now - last < 5.0:
                return  # throttle

            self._last_discovery_time[client.session_id] = now
            await client.send_thinking()

            try:
                # Encode frame for vision LM
                buf = io.BytesIO()
                Image.fromarray(frame).save(buf, format="JPEG", quality=70)
                image = dspy.Image(buf.getvalue())

                lm = self.router.get("vision") or self.router.get("reasoning")
                with dspy.context(lm=lm):
                    result = self._discover(image=image)

                suggestions = [
                    RecipeSuggestion(
                        name=s.get("name", ""),
                        description=s.get("description", ""),
                        confidence=s.get("confidence", "medium"),
                    )
                    for s in (result.suggestions or [])
                ]
                discovery = DiscoveryMessage(
                    items=result.toDict().get("items") or [],
                    suggestions=suggestions,
                )
                await client.send_discovery(discovery)
            except Exception:
                log.exception("Discovery mode failed")
            return

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
                    GuidanceMessage(text=output.guidance, severity=output.severity, expression=output.expression if output.expression != "other" else "default")
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
                    GuidanceMessage(text=output.guidance, severity=output.severity, expression=output.expression if output.expression != "other" else "default")
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
                GuidanceMessage(text=output.guidance, severity=output.severity, expression=output.expression if output.expression != "other" else "default")
            )

    async def _handle_chat(self, msg_type: str, payload: dict, client: ClientSession):
        chat_msg = ChatMessage(**payload)
        sid = client.session_id
        log.info("Chat from %s: %r | image_bytes=%s image_bytes_list=%s",
                 sid, chat_msg.text[:80],
                 f"{len(chat_msg.image_bytes)} chars" if chat_msg.image_bytes else "None",
                 f"{len(chat_msg.image_bytes_list)} items" if chat_msg.image_bytes_list else "None")

        self._history.add(sid, "user", chat_msg.text)

        await client.send_thinking()

        # Build image list from single or batch (already base64 strings from mobile)
        images: list[dspy.Image] = []
        if chat_msg.image_bytes_list:
            for b64 in chat_msg.image_bytes_list:
                images.append(dspy.Image(base64.b64decode(b64)))
        elif chat_msg.image_bytes:
            images.append(dspy.Image(base64.b64decode(chat_msg.image_bytes)))
        log.info("Built %d image(s) for chat, using %s LM", len(images), "vision" if images else "reasoning")

        lm = self.router.get("vision") if images else self.router.get("reasoning")
        session_mgr = self._get_session(client)

        try:
            # Run chat + character state in parallel
            async def _chat_call():
                with dspy.context(lm=lm):
                    return self._chat(
                        message=chat_msg.text,
                        images=images,
                        history=self._history.to_prompt_str(sid, last_n=20),
                    )

            async def _character_call():
                return await self.character_service.run_with_guidance_text(
                    guidance_text=chat_msg.text,
                    trigger="chat",
                    session_state=session_mgr.state,
                )

            result, character_state = await asyncio.gather(
                _chat_call(), _character_call(), return_exceptions=True
            )

            if isinstance(result, Exception):
                raise result

            if isinstance(character_state, Exception):
                log.warning("Character state failed: %s", character_state)
                from cookie.models import CharacterState
                character_state = CharacterState()

            suggestions = [
                RecipeSuggestion(
                    name=s.name,
                    description=s.description,
                    confidence=s.confidence,
                )
                for s in (result.suggestions or [])
            ]
            # If user selected a recipe, generate the plan
            recipe_plan: RecipePlan | None = None
            if chat_msg.text.startswith("Let's make "):
                try:
                    recipe_plan = self.recipe_gen.generate(chat_msg.text)
                    session_mgr.state.recipe_plan = recipe_plan
                    log.info("Generated recipe plan: %s (%d steps)", recipe_plan.title, len(recipe_plan.steps))
                except Exception:
                    log.exception("Recipe generation failed")

            response = ChatResponse(
                text=result.reply,
                items=result.toDict().get("items") or [],
                suggestions=suggestions,
                character_state=character_state,
                recipe_plan=recipe_plan,
            )
            self._history.add(sid, "assistant", result.reply)
            await client.send_chat_response(response)
        except Exception:
            log.exception("Chat handler failed")
            await client.send_chat_response(ChatResponse(text="Sorry, I had trouble understanding that."))

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
