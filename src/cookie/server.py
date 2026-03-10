"""Main server — stateless orchestrator. All inference runs in per-session workers."""

from __future__ import annotations

import asyncio
import base64
import logging
from functools import partial
from typing import Any

import dspy

from cookie.config import load_config
from cookie.history import HistoryManager
from cookie.inference.cooking import run_cooking
from cookie.inference.discovery import run_discovery
from cookie.inference.worker import InferenceWorker
from cookie.knowledge.recipes import RecipeGenerator
from cookie.models import (
    AudioMessage,
    ChatMessage,
    ChatResponse,
    FrameMessage,
    RecipePlan,
    RecipeSuggestion,
)
from cookie.reasoning.router import ModelRouter
from cookie.reasoning.signatures import (
    ChatWithKitchen,
    ClassifyVoiceIntent,
    DiscoverIngredients,
    ObserveCooking,
)
from cookie.transport.ws_server import ClientSession, TransportServer

log = logging.getLogger(__name__)


class CookingServer:
    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or load_config()
        server_cfg = self.config.get("server", {})

        self.router = ModelRouter(self.config.get("models", {}))
        self.recipe_gen = RecipeGenerator(self.router.get("reasoning"))
        self._history = HistoryManager(max_turns=40)

        # DSPy modules
        self._discover = dspy.ChainOfThought(DiscoverIngredients)
        self._observe = dspy.ChainOfThought(ObserveCooking)
        self._chat = dspy.ChainOfThought(ChatWithKitchen)
        self._classify_intent = dspy.ChainOfThought(ClassifyVoiceIntent)

        self.transport = TransportServer(
            host=server_cfg.get("host", "0.0.0.0"),
            port=server_cfg.get("port", 8420),
        )

        # One worker per connected session
        self._workers: dict[str, InferenceWorker] = {}

        self.transport.on_connect(self._on_connect)
        self.transport.on_disconnect(self._on_disconnect)
        self.transport.on_message("frame", self._handle_frame)
        self.transport.on_message("audio", self._handle_audio)
        self.transport.on_message("chat", self._handle_chat)

    # --- Connection lifecycle ---

    async def _on_connect(self, client: ClientSession):
        worker = InferenceWorker(client.session_id)
        self._workers[client.session_id] = worker

        def make_run_fn(phase):
            if phase == "discovery":
                return partial(
                    run_discovery,
                    lm=self.router.get("vision"),
                    discover_sig=self._discover,
                )
            return partial(
                run_cooking,
                lm=self.router.get("vision"),
                observe_sig=self._observe,
            )

        # Worker uses a dynamic run_fn that checks phase from context each call
        async def run_fn(frame, context, client):
            if context.phase == "discovery":
                return await run_discovery(
                    frame, context, client,
                    lm=self.router.get("vision"),
                    discover_sig=self._discover,
                )
            elif context.phase == "cooking":
                return await run_cooking(
                    frame, context, client,
                    lm=self.router.get("vision"),
                    observe_sig=self._observe,
                )

        worker.start(client, run_fn)

    async def _on_disconnect(self, client: ClientSession):
        worker = self._workers.pop(client.session_id, None)
        if worker:
            worker.stop()

    # --- Message handlers (all fast — just submit to worker) ---

    async def _handle_frame(self, msg_type: str, payload: dict, client: ClientSession):
        frame_msg = FrameMessage(**payload)
        raw = base64.b64decode(frame_msg.frame_bytes)
        log.info(
            "→ frame [%s] phase=%s step=%d size=%dB",
            client.session_id, frame_msg.context.phase,
            frame_msg.context.current_step, len(raw),
        )

        worker = self._workers.get(client.session_id)
        if worker:
            worker.submit(raw, frame_msg.context)

    async def _handle_audio(self, msg_type: str, payload: dict, client: ClientSession):
        audio_msg = AudioMessage(**payload)
        raw_audio = base64.b64decode(audio_msg.audio_bytes)

        # TODO: Whisper transcription → ClassifyVoiceIntent → route
        # For now log receipt
        log.info("Audio [%s] %d bytes", client.session_id, len(raw_audio))

    async def _handle_chat(self, msg_type: str, payload: dict, client: ClientSession):
        chat_msg = ChatMessage(**payload)
        sid = client.session_id
        log.info("Chat [%s]: %r", sid, chat_msg.text[:80])
        self._history.add(sid, "user", chat_msg.text)

        await client.send_thinking()

        images: list[dspy.Image] = []
        if chat_msg.image_bytes_list:
            for b64 in chat_msg.image_bytes_list:
                images.append(dspy.Image(base64.b64decode(b64)))
        elif chat_msg.image_bytes:
            images.append(dspy.Image(base64.b64decode(chat_msg.image_bytes)))

        lm = self.router.get("vision") if images else self.router.get("reasoning")

        try:
            with dspy.context(lm=lm):
                result = self._chat(
                    message=chat_msg.text,
                    images=images,
                    history=self._history.to_prompt_str(sid, last_n=20),
                )

            suggestions = [
                RecipeSuggestion(
                    name=s.name,
                    description=s.description,
                    confidence=s.confidence,
                )
                for s in (result.suggestions or [])
            ]

            recipe_plan: RecipePlan | None = None
            if chat_msg.text.startswith("Let's make "):
                try:
                    recipe_plan = self.recipe_gen.generate(chat_msg.text)
                    log.info("Recipe plan: %s (%d steps)", recipe_plan.title, len(recipe_plan.steps))
                except Exception:
                    log.exception("Recipe generation failed")

            response = ChatResponse(
                text=result.reply,
                items=result.toDict().get("items") or [],
                suggestions=suggestions,
                recipe_plan=recipe_plan,
            )
            self._history.add(sid, "assistant", result.reply)
            await client.send_chat_response(response)

        except Exception:
            log.exception("Chat handler failed")
            await client.send_chat_response(ChatResponse(text="Sorry, I had trouble with that."))

    async def start(self):
        await self.transport.start()
        log.info("Cooking server started")

    async def run_forever(self):
        await self.start()
        await asyncio.Future()

    async def stop(self):
        for worker in self._workers.values():
            worker.stop()
        await self.transport.stop()


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--config")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    config = load_config(args.config)
    server = CookingServer(config)
    asyncio.run(server.run_forever())


if __name__ == "__main__":
    main()
