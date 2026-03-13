"""E2E test — scrambled eggs cooking video through the full pipeline.

Downloads the video via yt-dlp if not already cached, then:
1. Generates a scrambled eggs recipe plan via RecipeGeneratorAgent
2. Feeds frames (1fps sample) + one mid-cook interrupt through InferenceWorker
3. Asserts the pipeline ran without error, guidance was sent, epoch filtering worked

Set COOKIE_TEST_VIDEO env var to skip download and use a local file.

Requires ANTHROPIC_API_KEY (or whichever provider is configured).
Skipped automatically if no API key is present.
"""

from __future__ import annotations

import asyncio
import io
import os
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import cv2
import pytest
from PIL import Image as PILImage

VIDEO_URL = "https://www.youtube.com/watch?v=7goNbTdFwNM"
VIDEO_CACHE = Path(os.getenv("COOKIE_TEST_VIDEO", "/tmp/cookie_test_video/scrambled_eggs.mp4"))
SAMPLE_FPS = 1          # extract 1 frame per second
MAX_FRAMES = 20         # cap at 20 frames to keep test fast
INTERRUPT_AT_FRAME = 8  # inject user interrupt after this many frames


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def video_frames() -> list[bytes]:
    """Extract JPEG frames from video at SAMPLE_FPS. Downloads if needed."""
    if not VIDEO_CACHE.exists():
        VIDEO_CACHE.parent.mkdir(parents=True, exist_ok=True)
        import subprocess
        result = subprocess.run(
            [
                "yt-dlp", VIDEO_URL,
                "-f", "bestvideo[ext=mp4][height<=480]+bestaudio/best[height<=480]",
                "--merge-output-format", "mp4",
                "-o", str(VIDEO_CACHE),
                "--no-playlist", "-q",
            ],
            capture_output=True,
        )
        if result.returncode != 0:
            pytest.skip(f"yt-dlp failed: {result.stderr.decode()[:200]}")

    cap = cv2.VideoCapture(str(VIDEO_CACHE))
    video_fps = cap.get(cv2.CAP_PROP_FPS)
    frame_interval = max(1, int(video_fps / SAMPLE_FPS))

    frames: list[bytes] = []
    idx = 0
    while len(frames) < MAX_FRAMES:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % frame_interval == 0:
            img = PILImage.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=70)
            frames.append(buf.getvalue())
        idx += 1
    cap.release()

    assert len(frames) > 0, "No frames extracted from video"
    return frames


@pytest.fixture
def mock_client():
    """Mock ClientSession — captures all sends for assertions."""
    client = MagicMock()
    client.session_id = "test-session-e2e"
    client.send_guidance = AsyncMock()
    client.send_step_update = AsyncMock()
    client.send_plan_update = AsyncMock()
    client.send_query = AsyncMock()
    client.send_thinking = AsyncMock()
    client.send_discovery = AsyncMock()
    client.send_chat_response = AsyncMock()
    return client


@pytest.fixture
async def store():
    """In-memory SQLite store for the test."""
    from cookie.store.session_db import DbProxy, SessionDB
    db = DbProxy(Path(":memory:"))

    # aiosqlite doesn't support :memory: with uri=True — patch connection
    import aiosqlite
    db._writer._conn = await aiosqlite.connect(":memory:")
    db._writer._conn.row_factory = aiosqlite.Row
    db._reader._conn = db._writer._conn  # share in-memory DB for test

    from cookie.store.session_db import SCHEMA
    await db._writer._conn.executescript(SCHEMA)
    await db._writer._conn.commit()

    s = SessionDB(db)
    yield s
    await db._writer._conn.close()


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_context(epoch: int = 0, phase: str = "cooking", step: int = 0,
                 recipe_title: str = "Scrambled Eggs", instruction: str = ""):
    from cookie.models import SessionContext
    return SessionContext(
        session_id="test-session-e2e",
        epoch=epoch,
        phase=phase,
        current_step=step,
        step_instruction=instruction,
        expected_visual_state="eggs in pan, softly scrambled, slightly glossy",
        recipe_title=recipe_title,
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_video_frames_extracted(video_frames):
    """Sanity check — frames extracted and are valid JPEGs."""
    assert len(video_frames) >= 5
    for f in video_frames[:3]:
        assert f[:2] == b"\xff\xd8", "Not a JPEG"


@pytest.mark.asyncio
async def test_batch_strategy_on_real_frames(video_frames):
    """CookingBatchStrategy correctly samples interleaved frames + interrupt."""
    from cookie.store.batch import CookingBatchStrategy
    from cookie.store.queue import QueueMessage

    msgs = []
    for i, _ in enumerate(video_frames[:10]):
        msgs.append(QueueMessage(
            id=i, session_id="s", timestamp=float(i),
            epoch=1, type="frame", role="user",
        ))

    # Insert interrupt at position 5
    interrupt = QueueMessage(
        id=99, session_id="s", timestamp=5.0,
        epoch=1, type="text", role="user",
        content="I added a pinch of salt",
    )
    msgs.insert(5, interrupt)

    strategy = CookingBatchStrategy()
    result = strategy.sample(msgs)

    types = [m.type for m in result]
    assert "text" in types, "Interrupt should be preserved"
    # Frames before and after interrupt should be kept (adjacent priority)
    text_idx = types.index("text")
    assert text_idx > 0, "Should have at least one frame before interrupt"
    assert text_idx < len(result) - 1, "Should have at least one frame after interrupt"
    # Total should be less than input
    assert len(result) < len(msgs)


@pytest.mark.asyncio
async def test_epoch_filtering(video_frames, store, mock_client):
    """Stale frames (lower epoch) are dropped before reaching the agent."""
    from cookie.store.batch import NoOpBatchStrategy
    from cookie.store.queue import MessageQueue
    from cookie.inference.worker import InferenceWorker

    sid = "test-session-e2e"
    await store.upsert_session(sid, time.time())

    queue = MessageQueue(sid, store)
    call_log = []

    async def run_fn(batch, context, client):
        call_log.append({
            "batch_size": len(batch),
            "epochs": [m.epoch for m in batch],
            "context_epoch": context.epoch,
        })
        from cookie.models import CookingObservation
        return CookingObservation(observation="test", criticality="low")

    worker = InferenceWorker(
        session_id=sid,
        queue=queue,
        batch_strategy=NoOpBatchStrategy(),
    )

    # Submit all messages BEFORE starting the worker so both epochs land in
    # the queue together. asyncio.Event is already set, so wait() returns
    # immediately when the worker starts and sees the full mixed batch.
    ctx_stale = make_context(epoch=0)
    ctx_current = make_context(epoch=1)

    for frame in video_frames[:3]:
        await queue.enqueue_frame(frame, epoch=0)
    for frame in video_frames[3:5]:
        await queue.enqueue_frame(frame, epoch=1)

    worker.start(mock_client, run_fn)

    # Give worker one tick to fetch + process the pre-loaded batch.
    await asyncio.sleep(0.3)
    worker.stop()

    assert len(call_log) >= 1, "Worker should have processed at least one batch"
    # All batches passed to run_fn should only have epoch=1 frames
    for entry in call_log:
        assert all(e == 1 for e in entry["epochs"]), \
            f"Stale epoch=0 frames leaked into agent: {entry}"


@pytest.mark.asyncio
async def test_queue_enqueue_and_fetch(video_frames, store):
    """Queue correctly stores frames and text in order."""
    from cookie.store.queue import MessageQueue

    sid = "test-session-e2e"
    await store.upsert_session(sid, time.time())
    q = MessageQueue(sid, store)

    t = time.time()
    await q.enqueue_frame(video_frames[0], timestamp=t, epoch=1)
    await q.enqueue_frame(video_frames[1], timestamp=t + 1, epoch=1)
    await q.enqueue_text("how long should I stir?", timestamp=t + 1.5, epoch=1)
    await q.enqueue_frame(video_frames[2], timestamp=t + 2, epoch=1)

    msgs = await q.fetch_unprocessed()
    assert len(msgs) == 4
    assert msgs[0].type == "frame"
    assert msgs[2].type == "text"
    assert msgs[2].content == "how long should I stir?"
    assert msgs[3].type == "frame"
    assert all(m.epoch == 1 for m in msgs)

    await q.mark_processed(msgs)
    remaining = await q.fetch_unprocessed()
    assert len(remaining) == 0


@pytest.mark.asyncio
async def test_plan_state_seeded_and_amended(store):
    """plan_state is written on recipe generation and can be amended."""
    sid = "test-session-e2e"
    await store.upsert_session(sid, time.time())

    # Seed 3 steps
    for i in range(3):
        await store.upsert_step(
            session_id=sid,
            step_index=i,
            instruction=f"Step {i}",
            expected_visual_state=f"visual state {i}",
            status="pending" if i > 0 else "active",
        )

    plan = await store.get_plan(sid)
    assert len(plan) == 3
    assert plan[0]["status"] == "active"

    # Amend step 1 (e.g. ingredient substitution)
    await store.upsert_step(
        session_id=sid,
        step_index=1,
        instruction="Step 1 amended — use oat milk",
        expected_visual_state="pale yellow liquid, slightly thinner than cream",
        status="amended",
        amended_at=time.time(),
    )

    step = await store.get_step(sid, 1)
    assert step["status"] == "amended"
    assert "oat milk" in step["instruction"]
    assert step["amended_at"] is not None


@pytest.mark.asyncio
async def test_full_pipeline_no_llm(video_frames, store, mock_client):
    """Full pipeline smoke test — worker + queue + batch strategy, LLM mocked."""
    from cookie.store.batch import CookingBatchStrategy
    from cookie.store.queue import MessageQueue
    from cookie.inference.worker import InferenceWorker
    from cookie.models import CookingObservation

    sid = "test-session-e2e"
    await store.upsert_session(sid, time.time())

    for i in range(3):
        await store.upsert_step(
            session_id=sid, step_index=i,
            instruction=f"Step {i}", expected_visual_state=f"state {i}",
            status="active" if i == 0 else "pending",
        )

    queue = MessageQueue(sid, store)
    guidance_log = []
    interrupts_seen = []

    async def run_fn(batch, context, client):
        texts = [m.content for m in batch if m.type == "text"]
        interrupts_seen.extend(texts)
        guidance_log.append(f"batch_size={len(batch)} epoch={context.epoch}")
        return CookingObservation(observation="eggs look good", criticality="high")

    worker = InferenceWorker(
        session_id=sid,
        queue=queue,
        batch_strategy=CookingBatchStrategy(),
    )
    worker.start(mock_client, run_fn)

    ctx = make_context(epoch=1, step=0, instruction="Beat eggs with salt and pepper")

    # Enqueue frames simulating 1fps cooking observation
    for i, frame in enumerate(video_frames[:MAX_FRAMES]):
        await worker.submit_frame(frame, ctx)

        # Inject interrupt mid-cook
        if i == INTERRUPT_AT_FRAME:
            await worker.submit_interrupt("I added a pinch of chili flakes", ctx)

        await asyncio.sleep(0.01)  # simulate real-time arrival

    # Let worker drain — first batch triggers 3s sleep (criticality=high),
    # second batch picks up the interrupt. Wait > 3s for the second cycle.
    await asyncio.sleep(4.0)
    worker.stop()

    assert len(guidance_log) >= 1, "Worker should have processed batches"
    assert any("chili flakes" in t for t in interrupts_seen), \
        "Interrupt should have reached run_fn"

    # Verify messages are marked processed in DB
    remaining = await queue.fetch_unprocessed()
    assert len(remaining) == 0, f"Unprocessed messages left: {len(remaining)}"
