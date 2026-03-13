"""SQLite-backed message queue.

Dumb append/fetch/mark — no sampling logic here.
The queue just stores messages and signals the worker when new ones arrive.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

from cookie.store.session_db import SessionDB


@dataclass
class QueueMessage:
    id: int
    session_id: str
    timestamp: float
    type: str          # 'frame' | 'text'
    role: str          # 'user' | 'agent'
    epoch: int = 0
    content: str | None = None
    frame_bytes: bytes | None = None
    frame_path: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class MessageQueue:
    """Per-session message queue backed by SessionDB.

    enqueue_frame() and enqueue_text() write to the DB and signal the worker.
    fetch_unprocessed() returns raw ordered QueueMessages — no sampling.
    mark_processed() clears them after the worker is done.
    """

    def __init__(self, session_id: str, store: SessionDB):
        self._session_id = session_id
        self._store = store
        self._event = asyncio.Event()

    async def enqueue_frame(
        self,
        frame_bytes: bytes,
        timestamp: float | None = None,
        metadata: dict | None = None,
        epoch: int = 0,
    ) -> int:
        msg_id = await self._store.enqueue_message(
            session_id=self._session_id,
            timestamp=timestamp or time.time(),
            type="frame",
            role="user",
            frame_bytes=frame_bytes,
            metadata=metadata,
            epoch=epoch,
        )
        self._event.set()
        return msg_id

    async def enqueue_text(
        self,
        content: str,
        timestamp: float | None = None,
        metadata: dict | None = None,
        epoch: int = 0,
    ) -> int:
        msg_id = await self._store.enqueue_message(
            session_id=self._session_id,
            timestamp=timestamp or time.time(),
            type="text",
            role="user",
            content=content,
            metadata=metadata,
            epoch=epoch,
        )
        self._event.set()
        return msg_id

    async def wait(self):
        """Block until at least one new message is enqueued."""
        await self._event.wait()
        self._event.clear()

    async def fetch_unprocessed(self) -> list[QueueMessage]:
        """Return all unprocessed messages ordered by timestamp. No sampling."""
        rows = await self._store.fetch_unprocessed(self._session_id)
        return [_row_to_msg(r) for r in rows]

    async def mark_processed(self, messages: list[QueueMessage]):
        await self._store.mark_processed([m.id for m in messages])


def _row_to_msg(row) -> QueueMessage:
    import json
    metadata = {}
    if row["metadata_json"]:
        try:
            metadata = json.loads(row["metadata_json"])
        except Exception:
            pass
    return QueueMessage(
        id=row["id"],
        session_id=row["session_id"],
        timestamp=row["timestamp"],
        epoch=row["epoch"],
        type=row["type"],
        role=row["role"],
        content=row["content"],
        frame_bytes=row["frame_data"],
        frame_path=row["frame_path"],
        metadata=metadata,
    )
