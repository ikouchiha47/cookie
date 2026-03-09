"""InferenceWorker — one per cooking session.

Mailbox pattern: latest frame always wins, older frames are discarded.
Vigilance-based sleep: the LLM tells us how urgently to check again.
Server is stateless — all context comes from the client with each frame.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from cookie.models import SessionContext

if TYPE_CHECKING:
    from cookie.transport.ws_server import ClientSession

log = logging.getLogger(__name__)

CRITICALITY_INTERVALS = {
    "high": 3,
    "medium": 10,
    "low": 30,
}

DISCOVERY_INTERVAL = 5  # seconds between discovery inferences


class InferenceWorker:
    """Per-session worker. Runs as an asyncio task.

    submit(frame, context) — called by _handle_frame, always fast, never blocks.
    _run()                 — the actual inference loop, sleeps between calls.
    """

    def __init__(self, session_id: str):
        self.session_id = session_id
        self._frame: bytes | None = None
        self._context: SessionContext = SessionContext()
        self._event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._client: ClientSession | None = None

    def start(self, client: ClientSession, run_fn):
        """Spawn the worker task. run_fn is the inference callable."""
        self._client = client
        self._run_fn = run_fn
        self._task = asyncio.create_task(
            self._run(), name=f"worker-{self.session_id}"
        )
        log.info("Worker started for %s", self.session_id)

    def stop(self):
        if self._task and not self._task.done():
            self._task.cancel()
            log.info("Worker stopped for %s", self.session_id)

    def submit(self, frame: bytes, context: SessionContext):
        """Mailbox — always overwrites, never queues. Called from _handle_frame."""
        self._frame = frame
        self._context = context
        self._event.set()

    async def _run(self):
        while True:
            try:
                await self._event.wait()
                self._event.clear()

                frame = self._frame
                context = self._context

                if frame is None:
                    continue

                if context.phase == "discovery":
                    await self._run_fn(frame, context, self._client)
                    await asyncio.sleep(DISCOVERY_INTERVAL)

                elif context.phase == "cooking":
                    result = await self._run_fn(frame, context, self._client)
                    interval = CRITICALITY_INTERVALS.get(
                        getattr(result, "criticality", "medium"), 10
                    )
                    log.info(
                        "Worker [%s] sleeping %ds (criticality=%s)",
                        self.session_id, interval,
                        getattr(result, "criticality", "medium"),
                    )
                    await asyncio.sleep(interval)

            except asyncio.CancelledError:
                break
            except Exception:
                log.exception("Worker error [%s]", self.session_id)
                await asyncio.sleep(5)  # backoff on error
