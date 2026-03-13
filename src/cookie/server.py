"""CookingServer — orchestrator. Wires transport, store, queue, workers, and agents."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from typing import Any

import dspy

from cookie.config import load_config
from cookie.inference.cooking_agent import make_cooking_agent, run_cooking_agent
from cookie.inference.modules import DiscoveryAgent
from cookie.inference.recipe_generator import RecipeGeneratorAgent
from cookie.inference.worker import InferenceWorker
from cookie.models import (
    AudioMessage,
    ChatMessage,
    ChatResponse,
    DiscoveryMessage,
    FrameMessage,
    RecipePlan,
    RecipeSuggestion,
    SessionContext,
)
from cookie.reasoning.router import ModelRouter
from cookie.reasoning.signatures import ChatWithKitchen, ClassifyVoiceIntent
from cookie.store.batch import CookingBatchStrategy
from cookie.store.queue import MessageQueue
from cookie.store.session_db import DB_PATH, DbProxy, SessionDB, format_history
from cookie.transport.ws_server import ClientSession, TransportServer

log = logging.getLogger(__name__)


class CookingServer:
    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or load_config()
        server_cfg = self.config.get("server", {})

        self.router = ModelRouter(self.config.get("models", {}))
        log.info("Models loaded: %s", list(self.router.keys()))

        # Shared DB proxy — WAL mode, separate read/write connections
        self._db = DbProxy(DB_PATH)
        self._store: SessionDB | None = None  # opened in start()

        # Shared agents (stateless — safe to share across sessions)
        self._discover = DiscoveryAgent()
        self._recipe_gen = RecipeGeneratorAgent()
        self._chat = dspy.ChainOfThought(ChatWithKitchen)
        self._classify_intent = dspy.ChainOfThought(ClassifyVoiceIntent)
        log.info("Agents initialised")

        self.transport = TransportServer(
            host=server_cfg.get("host", "0.0.0.0"),
            port=server_cfg.get("port", 8420),
        )

        self._workers: dict[str, InferenceWorker] = {}
        self._queues: dict[str, MessageQueue] = {}

        self.transport.on_connect(self._on_connect)
        self.transport.on_disconnect(self._on_disconnect)
        self.transport.on_message("frame", self._handle_frame)
        self.transport.on_message("audio", self._handle_audio)
        self.transport.on_message("chat", self._handle_chat)
        self.transport.on_message("interrupt", self._handle_interrupt)
        self.transport.on_message("abort", self._handle_abort_ws)
        self.transport.on_http_abort(self._handle_abort_http)

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def start(self):
        await self._db.open()
        self._store = SessionDB(self._db)
        await self.transport.start()
        log.info("CookingServer started — DB=%s", self._db.db_path)

    async def run_forever(self):
        await self.start()
        await asyncio.Future()

    async def stop(self):
        log.info("Stopping server — shutting down %d workers", len(self._workers))
        for worker in self._workers.values():
            worker.stop()
        await self.transport.stop()
        await self._db.close()
        log.info("Server stopped")

    # ── Connection lifecycle ─────────────────────────────────────────────────

    async def _spawn_worker(self, client: ClientSession):
        """Create queue + agent + worker for a client session. Idempotent — stops existing worker first."""
        sid = client.session_id

        # Stop any existing worker/queue
        old_worker = self._workers.pop(sid, None)
        if old_worker:
            old_worker.stop()
        self._queues.pop(sid, None)

        queue = MessageQueue(sid, self._store)
        self._queues[sid] = queue

        cooking_agent = await make_cooking_agent(
            session_id=sid,
            store=self._store,
            client=client,
            lm=self.router.get("vision"),
        )
        log.debug("[%s] CookingAgent created with tools", sid)

        async def run_fn(batch, context, client):
            log.debug(
                "[%s] run_fn called — phase=%s batch_size=%d",
                sid, context.phase, len(batch),
            )
            if context.phase == "discovery":
                return await self._run_discovery(batch, context, client)
            elif context.phase == "cooking":
                return await run_cooking_agent(
                    batch=batch,
                    context=context,
                    store=self._store,
                    client=client,
                    agent=cooking_agent,
                )
            else:
                log.warning("[%s] Unknown phase %r — skipping inference", sid, context.phase)

        worker = InferenceWorker(
            session_id=sid,
            queue=queue,
            batch_strategy=CookingBatchStrategy(),
        )
        worker.start(client, run_fn)
        self._workers[sid] = worker
        log.info("[%s] Worker started", sid)

    async def _on_connect(self, client: ClientSession):
        sid = client.session_id
        log.info("Client connected [%s]", sid)
        await self._store.upsert_session(sid, started_at=time.time())
        await client.send_session_init()
        await self._spawn_worker(client)

    async def _on_disconnect(self, client: ClientSession):
        sid = client.session_id
        log.info("Client disconnected [%s]", sid)
        worker = self._workers.pop(sid, None)
        if worker:
            worker.stop()
            log.debug("[%s] Worker stopped", sid)
        self._queues.pop(sid, None)

    # ── Message handlers ─────────────────────────────────────────────────────

    async def _handle_frame(self, msg_type: str, payload: dict, client: ClientSession):
        sid = client.session_id
        try:
            frame_msg = FrameMessage(**payload)
            raw = base64.b64decode(frame_msg.frame_bytes)
            log.info(
                "→ frame [%s] epoch=%d phase=%s step=%d size=%dB hash=%s",
                sid, frame_msg.context.epoch,
                frame_msg.context.phase,
                frame_msg.context.current_step,
                len(raw),
                frame_msg.frame_hash[:8] if frame_msg.frame_hash else "none",
            )
            worker = self._workers.get(sid)
            if worker:
                await worker.submit_frame(raw, frame_msg.context)
                log.debug("[%s] Frame enqueued to worker", sid)
            else:
                log.warning("[%s] Frame received but no worker found — dropped", sid)
        except Exception:
            log.exception("[%s] Failed to handle frame message", sid)

    async def _handle_interrupt(self, msg_type: str, payload: dict, client: ClientSession):
        """Voice/text interrupt mid-cook — enqueue as text message to worker."""
        sid = client.session_id
        text = payload.get("text", "").strip()
        if not text:
            log.warning("[%s] Empty interrupt received — ignored", sid)
            return

        context_data = payload.get("context", {})
        context = SessionContext(**context_data) if context_data else SessionContext()

        log.info("→ interrupt [%s] epoch=%d phase=%s text=%r", sid, context.epoch, context.phase, text[:80])

        worker = self._workers.get(sid)
        if worker:
            await worker.submit_interrupt(text, context)
            log.debug("[%s] Interrupt enqueued to worker", sid)
        else:
            log.warning("[%s] Interrupt received but no worker found — dropped", sid)

    async def _handle_audio(self, msg_type: str, payload: dict, client: ClientSession):
        sid = client.session_id
        audio_msg = AudioMessage(**payload)
        raw_audio = base64.b64decode(audio_msg.audio_bytes)
        log.info(
            "→ audio [%s] %dB is_speech=%s",
            sid, len(raw_audio), audio_msg.is_speech,
        )
        # TODO: Whisper transcription → submit_interrupt if is_speech
        log.debug("[%s] Audio stub — Whisper not yet wired", sid)

    async def _handle_chat(self, msg_type: str, payload: dict, client: ClientSession):
        sid = client.session_id
        chat_msg = ChatMessage(**payload)
        log.info("→ chat [%s] text=%r images=%d", sid, chat_msg.text[:80],
                 len(chat_msg.image_bytes_list or []) + (1 if chat_msg.image_bytes else 0))

        await self._store.enqueue_message(
            session_id=sid, timestamp=time.time(), type="chat",
            role="user", content=chat_msg.text, processed=1,
        )
        await client.send_thinking()

        images: list[dspy.Image] = []
        if chat_msg.image_bytes_list:
            for b64 in chat_msg.image_bytes_list:
                images.append(dspy.Image(base64.b64decode(b64)))
        elif chat_msg.image_bytes:
            images.append(dspy.Image(base64.b64decode(chat_msg.image_bytes)))

        lm = self.router.get("vision") if images else self.router.get("reasoning")
        log.debug("[%s] Chat using lm=%s images=%d", sid, lm, len(images))

        try:
            history_rows = await self._store.fetch_recent_messages(sid, limit=20)
            with dspy.context(lm=lm):
                result = await self._chat.acall(
                    message=chat_msg.text,
                    images=images,
                    history=format_history(history_rows),
                )
            log.debug("[%s] Chat reply generated: %r", sid, result.reply[:80])

            suggestions = [
                RecipeSuggestion(name=s.name, description=s.description, confidence=s.confidence)
                for s in (result.suggestions or [])
            ]

            recipe_plan: RecipePlan | None = None
            if chat_msg.text.startswith("Let's make "):
                log.info("[%s] Recipe generation triggered: %r", sid, chat_msg.text[:80])
                try:
                    recipe_plan = await self._recipe_gen.generate_plan(chat_msg.text)
                    log.info(
                        "[%s] Recipe generated: %r (%d steps)",
                        sid, recipe_plan.title, len(recipe_plan.steps),
                    )
                    # Seed plan_state in DB so CookingAgent tools can read/amend it
                    await self._seed_plan_state(sid, recipe_plan)
                except Exception:
                    log.exception("[%s] Recipe generation failed", sid)

            response = ChatResponse(
                text=result.reply,
                items=result.toDict().get("items") or [],
                suggestions=suggestions,
                recipe_plan=recipe_plan,
            )
            await self._store.enqueue_message(
                session_id=sid, timestamp=time.time(), type="chat",
                role="assistant", content=result.reply, processed=1,
            )
            await client.send_chat_response(response)
            log.debug("[%s] Chat response sent", sid)

        except Exception:
            log.exception("[%s] Chat handler failed", sid)
            await client.send_chat_response(ChatResponse(text="Sorry, I had trouble with that."))

    # ── Discovery (shared agent, no per-session state needed) ────────────────

    async def _run_discovery(self, batch, context: SessionContext, client: ClientSession):
        sid = client.session_id
        frames = [m for m in batch if m.type == "frame"]
        if not frames:
            log.debug("[%s] Discovery called with no frames — skipping", sid)
            return None

        # Use the most recent frame
        latest = frames[-1]
        log.info("[%s] Discovery inference on frame t=%.2f", sid, latest.timestamp)

        await client.send_thinking()
        try:
            import io
            from PIL import Image as PILImage

            frame_bytes = latest.frame_bytes
            if not frame_bytes and latest.frame_path:
                from pathlib import Path
                frame_bytes = Path(latest.frame_path).read_bytes()

            img = PILImage.open(io.BytesIO(frame_bytes))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=70)
            image = dspy.Image(buf.getvalue())

            history_rows = await self._store.fetch_recent_messages(sid, limit=10)
            history = format_history(history_rows)

            with dspy.context(lm=self.router.get("vision")):
                result = await self._discover.acall(image=image, user_hint="", history=history)

            items = result.ingredients or []
            if not items:
                log.info("[%s] Discovery: nothing identified", sid)
                return None

            suggestions = [
                RecipeSuggestion(name=s.name, description=s.description, confidence=s.confidence)
                for s in (result.suggestions or [])
            ]
            log.info("[%s] Discovery: items=%s suggestions=%s", sid, items, [s.name for s in suggestions])

            await self._store.enqueue_message(
                session_id=sid, timestamp=time.time(), type="discovery",
                role="assistant", content=f"Identified: {', '.join(items)}", processed=1,
            )

            await client.send_discovery(DiscoveryMessage(items=items, suggestions=suggestions))
            return None

        except Exception:
            log.exception("[%s] Discovery inference failed", sid)
            return None

    # ── Abort ────────────────────────────────────────────────────────────────

    async def _abort_session(self, sid: str) -> bool:
        """Cancel worker, mark DB row aborted. Returns True if session existed."""
        worker = self._workers.pop(sid, None)
        if worker is None and sid not in self._queues:
            log.warning("[%s] Abort requested but session not found", sid)
            return False

        if worker:
            worker.stop()  # cancels asyncio task → CancelledError propagates into run_fn
            log.info("[%s] Worker cancelled (abort)", sid)

        self._queues.pop(sid, None)

        aborted_at = time.time()
        await self._store.mark_aborted(sid, aborted_at)
        log.info("[%s] Session aborted at %.3f", sid, aborted_at)
        return True

    async def _handle_abort_ws(self, msg_type: str, payload: dict, client: ClientSession):
        """Handle abort sent over the WebSocket connection."""
        sid = client.session_id
        log.info("→ abort (WS) [%s]", sid)
        existed = await self._abort_session(sid)
        if existed:
            try:
                await client.send_aborted()
            except Exception:
                pass  # client may already be closing
        # Recreate worker so the same WS connection can continue without reconnecting
        await self._spawn_worker(client)

    async def _handle_abort_http(self, session_id: str) -> tuple[int, bytes]:
        """Handle POST /sessions/{session_id}/abort — called when WS is unavailable."""
        log.info("→ abort (HTTP) [%s]", session_id)
        existed = await self._abort_session(session_id)
        if not existed:
            return 404, b'{"error":"session not found"}'

        # If the WS client is still connected, notify it so the UI can react.
        client = self.transport.sessions.get(session_id)
        if client:
            try:
                await client.send_aborted()
            except Exception:
                pass

        return 202, b'{"status":"aborted"}'

    # ── Helpers ──────────────────────────────────────────────────────────────

    async def _seed_plan_state(self, session_id: str, plan: RecipePlan):
        """Write initial plan_state rows so CookingAgent tools can read and amend steps."""
        log.debug("[%s] Seeding plan_state (%d steps)", session_id, len(plan.steps))
        for step in plan.steps:
            await self._store.upsert_step(
                session_id=session_id,
                step_index=step.index,
                instruction=step.instruction,
                expected_visual_state=step.expected_visual_state,
                expected_texture=step.expected_texture,
                expected_taste_smell=step.expected_taste_smell,
                status="pending",
            )
        log.info("[%s] plan_state seeded (%d steps)", session_id, len(plan.steps))


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--config")
    parser.add_argument("--debug", action="store_true", help="Set log level to DEBUG")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s.%(msecs)03d %(levelname)-8s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )
    config = load_config(args.config)
    server = CookingServer(config)
    asyncio.run(server.run_forever())


if __name__ == "__main__":
    main()
