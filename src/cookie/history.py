"""HistoryManager — structured conversation history per session.

Each turn is stored as:
    {"role": "user"|"assistant", "content": str, "think": str | None}

Designed to be SQLite-backed later; currently in-memory only.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal


@dataclass
class Turn:
    role: Literal["user", "assistant"]
    content: str
    think: str | None = None

    def to_dict(self) -> dict:
        d: dict = {"role": self.role, "content": self.content}
        if self.think:
            d["think"] = self.think
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Turn":
        return cls(role=d["role"], content=d["content"], think=d.get("think"))


class HistoryManager:
    """In-memory history store, one list of Turns per session.

    Later: swap _store for an sqlite-backed repository without changing
    the public API.
    """

    def __init__(self, max_turns: int = 40) -> None:
        self.max_turns = max_turns
        self._store: dict[str, list[Turn]] = {}

    # ── Write ────────────────────────────────────────────────────────────────

    def add(self, session_id: str, role: Literal["user", "assistant"],
            content: str, think: str | None = None) -> None:
        turns = self._store.setdefault(session_id, [])
        turns.append(Turn(role=role, content=content, think=think))
        # Trim oldest turns when over limit (keep pairs when possible)
        if len(turns) > self.max_turns:
            self._store[session_id] = turns[-self.max_turns:]

    def clear(self, session_id: str) -> None:
        self._store.pop(session_id, None)

    # ── Read ─────────────────────────────────────────────────────────────────

    def get(self, session_id: str) -> list[Turn]:
        return list(self._store.get(session_id, []))

    def to_json(self, session_id: str) -> str:
        return json.dumps([t.to_dict() for t in self.get(session_id)], ensure_ascii=False)

    def to_prompt_str(self, session_id: str, last_n: int = 20) -> str:
        """Convert recent turns to a plain string for the DSPy signature."""
        turns = self._store.get(session_id, [])[-last_n:]
        lines = []
        for t in turns:
            prefix = "User" if t.role == "user" else "Assistant"
            lines.append(f"{prefix}: {t.content}")
        return "\n".join(lines)
