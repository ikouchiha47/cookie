"""SQLite-backed session store.

WAL mode with two connections — one writer, one reader — behind a DbProxy
that all callers use. This avoids lock contention and is safe for the
asyncio single-threaded model.

Tables:
  sessions   — one row per cooking session
  messages   — unified log of frames + text, used as queue backing store
  plan_state — current state of each recipe step, mutable by agent
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import aiosqlite

from cookie.store.sql import messages as sql_msg
from cookie.store.sql import plan as sql_plan
from cookie.store.sql import sessions as sql_sess
from cookie.store.sql.schema import SCHEMA

log = logging.getLogger(__name__)


def format_history(rows) -> str:
    """Convert a list of message rows (from fetch_recent_messages) to a plain
    prompt string for DSPy signatures."""
    lines = []
    for r in rows:
        role = r["role"]
        content = r["content"] or ""
        if r["metadata_json"]:
            try:
                meta = json.loads(r["metadata_json"])
                content = meta.get("guidance", "") or content
            except Exception:
                pass
        if content:
            lines.append(f"[{role}] {content}")
    return "\n".join(lines)

DEBUG_SAVE_FRAMES = os.getenv("DEBUG_SAVE_FRAMES", "").lower() in ("1", "true", "yes")
DEBUG_FRAMES_DIR = Path(os.getenv("DEBUG_FRAMES_DIR", "/tmp/cookie_frames"))
DB_PATH = Path(os.getenv("COOKIE_DB_PATH", "/tmp/cookie_sessions.db"))


class _DbConnection:
    """Thin wrapper around a single aiosqlite connection."""

    def __init__(self, path: Path, readonly: bool = False):
        self._path = path
        self._readonly = readonly
        self._conn: aiosqlite.Connection | None = None

    async def open(self):
        self._conn = await aiosqlite.connect(f"file:{self._path}?cache=shared", uri=True)
        self._conn.row_factory = aiosqlite.Row
        if not self._readonly:
            await self._conn.executescript(SCHEMA)
            await self._conn.commit()

    async def close(self):
        if self._conn:
            await self._conn.close()
            self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        assert self._conn, "DbConnection not opened"
        return self._conn


class DbProxy:
    """Proxy with separate read and write connections.

    All writes go through the writer connection.
    All reads go through the reader connection.
    WAL mode allows concurrent read + write without blocking.
    """

    def __init__(self, db_path: Path = DB_PATH):
        self._writer = _DbConnection(db_path, readonly=False)
        self._reader = _DbConnection(db_path, readonly=False)  # WAL: no locking issue
        self.db_path = db_path

    async def open(self):
        await self._writer.open()
        await self._reader.open()
        if DEBUG_SAVE_FRAMES:
            DEBUG_FRAMES_DIR.mkdir(parents=True, exist_ok=True)
            log.info("Debug frame saving enabled → %s", DEBUG_FRAMES_DIR)
        log.info("DbProxy opened at %s", self.db_path)

    async def close(self):
        await self._writer.close()
        await self._reader.close()

    @property
    def w(self) -> aiosqlite.Connection:
        return self._writer.conn

    @property
    def r(self) -> aiosqlite.Connection:
        return self._reader.conn


class SessionDB:
    """All session store operations. Takes a DbProxy — never opens connections itself."""

    def __init__(self, db: DbProxy):
        self._db = db

    # --- Sessions ---

    async def upsert_session(
        self,
        session_id: str,
        started_at: float,
        phase: str = "discovery",
        recipe_plan_json: str | None = None,
    ):
        await self._db.w.execute(
            sql_sess.UPSERT,
            (session_id, started_at, phase, recipe_plan_json),
        )
        await self._db.w.commit()

    async def mark_aborted(self, session_id: str, aborted_at: float):
        """Mark a session as aborted. Does not touch messages or plan_state."""
        await self._db.w.execute(sql_sess.MARK_ABORTED, (aborted_at, session_id))
        await self._db.w.commit()
        log.info("[%s] Session marked aborted at %.3f", session_id, aborted_at)

    async def get_session(self, session_id: str) -> aiosqlite.Row | None:
        async with self._db.r.execute(sql_sess.GET_BY_ID, (session_id,)) as cur:
            return await cur.fetchone()

    # --- Messages ---

    async def enqueue_message(
        self,
        session_id: str,
        timestamp: float,
        type: str,
        role: str,
        content: str | None = None,
        frame_bytes: bytes | None = None,
        metadata: dict | None = None,
        epoch: int = 0,
        processed: int = 0,
    ) -> int:
        frame_path: str | None = None
        if frame_bytes and DEBUG_SAVE_FRAMES:
            frame_path = str(
                DEBUG_FRAMES_DIR / f"{session_id}_{int(timestamp * 1000)}.jpg"
            )
            Path(frame_path).write_bytes(frame_bytes)
            log.debug("Frame saved to %s", frame_path)

        cursor = await self._db.w.execute(
            sql_msg.INSERT,
            (
                session_id, timestamp, epoch, type, role, content,
                frame_bytes,
                frame_path,
                json.dumps(metadata) if metadata else None,
                processed,
            ),
        )
        await self._db.w.commit()
        return cursor.lastrowid

    async def fetch_unprocessed(self, session_id: str) -> list[aiosqlite.Row]:
        async with self._db.r.execute(sql_msg.FETCH_UNPROCESSED, (session_id,)) as cur:
            return await cur.fetchall()

    async def mark_processed(self, ids: list[int]):
        if not ids:
            return
        placeholders = ",".join("?" * len(ids))
        await self._db.w.execute(
            sql_msg.MARK_PROCESSED_TEMPLATE.format(placeholders=placeholders), ids
        )
        await self._db.w.commit()
        log.debug("Marked %d messages as processed: %s", len(ids), ids)

    async def fetch_recent_messages(
        self, session_id: str, limit: int = 20
    ) -> list[aiosqlite.Row]:
        """Rolling history window for agent context."""
        async with self._db.r.execute(
            sql_msg.FETCH_RECENT_PROCESSED, (session_id, limit)
        ) as cur:
            rows = await cur.fetchall()
        return list(reversed(rows))

    # --- Plan state ---

    async def upsert_step(
        self,
        session_id: str,
        step_index: int,
        instruction: str,
        expected_visual_state: str = "",
        expected_texture: str = "",
        expected_taste_smell: str = "",
        status: str = "pending",
        amended_at: float | None = None,
    ):
        log.debug(
            "[%s] upsert_step index=%d status=%s amended=%s",
            session_id, step_index, status, amended_at is not None,
        )
        await self._db.w.execute(
            sql_plan.UPSERT_STEP,
            (
                session_id, step_index, instruction,
                expected_visual_state, expected_texture, expected_taste_smell,
                status, amended_at,
            ),
        )
        await self._db.w.commit()

    async def get_plan(self, session_id: str) -> list[aiosqlite.Row]:
        async with self._db.r.execute(sql_plan.GET_PLAN, (session_id,)) as cur:
            return await cur.fetchall()

    async def get_step(self, session_id: str, step_index: int) -> aiosqlite.Row | None:
        async with self._db.r.execute(
            sql_plan.GET_STEP, (session_id, step_index)
        ) as cur:
            return await cur.fetchone()
