"""InferenceWorker — one per cooking session.

SQLite-backed queue. BatchStrategy injected at construction.

Worker pipeline:
    wait → fetch → epoch-filter → sample → run agent (cancellable) → mark processed → sleep

In-flight cancellation:
    When a new message arrives with a higher epoch than the currently running
    batch, the inflight CancelScope is cancelled. CancelledError propagates
    through dspy's HTTP call, tearing down the LLM request immediately.
    This covers the discovery→cooking transition: user taps a recipe card,
    epoch bumps, in-flight discovery call is cancelled before it can send a
    stale send_discovery() to the client.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Awaitable, Callable

import anyio

from cookie.models import SessionContext
from cookie.store.batch import BatchStrategy, CookingBatchStrategy
from cookie.store.queue import MessageQueue, QueueMessage

if TYPE_CHECKING:
    from cookie.transport.ws_server import ClientSession

log = logging.getLogger(__name__)

CRITICALITY_INTERVALS = {"high": 3, "medium": 10, "low": 30}


class InferenceWorker:
    """Per-session worker. Runs as an asyncio task.

    submit_frame()     — enqueue a camera frame
    submit_interrupt() — enqueue a voice/text interrupt
    _run()             — orchestration loop
    _run_batch()       — single inference cycle, wrapped in a CancelScope
    """

    def __init__(
        self,
        session_id: str,
        queue: MessageQueue,
        batch_strategy: BatchStrategy | None = None,
    ):
        self.session_id = session_id
        self._queue = queue
        self._strategy = batch_strategy or CookingBatchStrategy()
        self._task: asyncio.Task | None = None
        self._client: ClientSession | None = None
        self._run_fn: Callable[..., Awaitable] | None = None
        self._last_context: SessionContext = SessionContext()

        # Cancellation scope for the currently running inference batch.
        # Set while _run_batch() is executing; None otherwise.
        self._inflight_scope: anyio.CancelScope | None = None
        self._inflight_epoch: int = -1

    # ── Lifecycle ────────────────────────────────────────────────────────────

    def start(self, client: ClientSession, run_fn: Callable[..., Awaitable]):
        self._client = client
        self._run_fn = run_fn
        self._task = asyncio.create_task(
            self._run(), name=f"worker-{self.session_id}"
        )
        log.info("Worker started [%s]", self.session_id)

    def stop(self):
        if self._task and not self._task.done():
            self._task.cancel()
            log.info("Worker stopped [%s]", self.session_id)

    # ── Submit helpers ───────────────────────────────────────────────────────

    async def submit_frame(self, frame_bytes: bytes, context: SessionContext):
        self._last_context = context
        await self._queue.enqueue_frame(
            frame_bytes=frame_bytes,
            metadata=context.model_dump(),
            epoch=context.epoch,
        )
        self._maybe_cancel_inflight(context.epoch)

    async def submit_interrupt(self, text: str, context: SessionContext):
        self._last_context = context
        await self._queue.enqueue_text(
            content=text,
            metadata=context.model_dump(),
            epoch=context.epoch,
        )
        self._maybe_cancel_inflight(context.epoch)

    def _maybe_cancel_inflight(self, incoming_epoch: int):
        """Cancel the running inference scope if a higher epoch has arrived."""
        if (
            self._inflight_scope is not None
            and not self._inflight_scope.cancel_called
            and incoming_epoch > self._inflight_epoch
        ):
            log.info(
                "Worker [%s] cancelling in-flight inference (epoch %d → %d)",
                self.session_id, self._inflight_epoch, incoming_epoch,
            )
            self._inflight_scope.cancel()

    # ── Main loop ────────────────────────────────────────────────────────────

    async def _run(self):
        while True:
            try:
                await self._queue.wait()

                raw = await self._queue.fetch_unprocessed()
                if not raw:
                    continue

                current_epoch = max(m.epoch for m in raw)
                fresh = [m for m in raw if m.epoch == current_epoch]
                stale = [m for m in raw if m.epoch < current_epoch]

                if stale:
                    log.info(
                        "Worker [%s] dropping %d stale message(s) (epoch %s < %d)",
                        self.session_id, len(stale),
                        {m.epoch for m in stale}, current_epoch,
                    )
                    await self._queue.mark_processed(stale)

                if not fresh:
                    continue

                batch = self._strategy.sample(fresh)
                log.info(
                    "Worker [%s] epoch=%d batch: %d raw → %d fresh → %d sampled",
                    self.session_id, current_epoch, len(raw), len(fresh), len(batch),
                )

                await self._run_batch(batch, raw, current_epoch)

            except asyncio.CancelledError:
                break
            except Exception:
                log.exception("Worker error [%s]", self.session_id)
                await asyncio.sleep(5)

    async def _run_batch(
        self,
        batch: list[QueueMessage],
        raw: list[QueueMessage],
        epoch: int,
    ):
        """Run one inference cycle inside a CancelScope.

        If a higher-epoch message arrives during the LLM call,
        _maybe_cancel_inflight() will call scope.cancel(), which raises
        Cancelled inside the dspy await and unwinds immediately.
        The raw messages are NOT marked processed — they stay in the queue
        so the next loop iteration re-fetches them under the new epoch.
        """
        self._inflight_epoch = epoch

        with anyio.CancelScope() as scope:
            self._inflight_scope = scope

            result = await self._run_fn(
                batch=batch,
                context=self._last_context,
                client=self._client,
            )

        self._inflight_scope = None

        if scope.cancelled_caught:
            log.info(
                "Worker [%s] in-flight inference cancelled (epoch %d superseded)",
                self.session_id, epoch,
            )
            # Leave raw messages unprocessed — next loop will re-fetch with new epoch
            return

        await self._queue.mark_processed(raw)

        interval = CRITICALITY_INTERVALS.get(
            getattr(result, "criticality", "medium"), 10
        )
        log.info(
            "Worker [%s] sleeping %ds (criticality=%s)",
            self.session_id, interval, getattr(result, "criticality", "medium"),
        )
        await asyncio.sleep(interval)
