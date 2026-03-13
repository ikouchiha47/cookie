"""Batch sampling strategies for the inference worker.

The queue holds raw messages in arrival order. Before passing to the agent,
the worker runs a BatchStrategy to trim the batch down to what's actually useful.

Strategy contract:
    sample(messages: list[QueueMessage]) -> list[QueueMessage]

Rules:
- Queue is dumb — it never calls this.
- Agent is pure — it never calls this.
- Worker owns the fetch → sample → run pipeline.
"""

from __future__ import annotations

from typing import Protocol

from cookie.store.queue import QueueMessage


class BatchStrategy(Protocol):
    def sample(self, messages: list[QueueMessage]) -> list[QueueMessage]:
        ...


class NoOpBatchStrategy:
    """Returns all messages unchanged. Used in tests."""

    def sample(self, messages: list[QueueMessage]) -> list[QueueMessage]:
        return messages


class CookingBatchStrategy:
    """Sampling strategy for the cooking inference loop.

    For a batch like: [f0, f1, f2, f3, text, f4, f5, f6]

    - Split into runs of contiguous frames separated by text messages.
    - For each frame run: keep start + end frame only (drop middle).
    - Text messages stay in their exact position — temporal order preserved.
    - Frames adjacent to a text message get priority:
        the frame immediately before and after each text is always kept.

    Result: [f0, f3, text, f4, f6]
    """

    def sample(self, messages: list[QueueMessage]) -> list[QueueMessage]:
        if not messages:
            return []

        # Find indices of text messages — these are interrupt anchors
        text_indices: set[int] = {
            i for i, m in enumerate(messages) if m.type == "text"
        }

        # Frames adjacent to any text message are always kept
        priority_indices: set[int] = set()
        for ti in text_indices:
            if ti - 1 >= 0:
                priority_indices.add(ti - 1)
            if ti + 1 < len(messages):
                priority_indices.add(ti + 1)

        result: list[QueueMessage] = []
        i = 0
        while i < len(messages):
            msg = messages[i]

            if msg.type == "text":
                result.append(msg)
                i += 1
                continue

            # Start of a frame run — collect until next text or end
            run_start = i
            while i < len(messages) and messages[i].type == "frame":
                i += 1
            run_end = i - 1  # inclusive

            run = messages[run_start : run_end + 1]

            if len(run) <= 2:
                result.extend(run)
            else:
                kept: list[QueueMessage] = []
                seen_ids: set[int] = set()

                def keep(m: QueueMessage):
                    if m.id not in seen_ids:
                        kept.append(m)
                        seen_ids.add(m.id)

                # Always keep first and last of the run
                keep(run[0])
                keep(run[-1])

                # Keep priority frames (adjacent to text messages)
                for idx in range(run_start, run_end + 1):
                    if idx in priority_indices:
                        keep(messages[idx])

                # Sort by original position
                kept.sort(key=lambda m: m.timestamp)
                result.extend(kept)

        return result
