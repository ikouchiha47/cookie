"""
Simulate a cooking session against the live server via WebSocket.

Usage:
  # Discovery phase with a test image
  uv run python scripts/simulate.py discovery --image scripts/assets/kitchen.jpg

  # Cooking phase with a recipe step
  uv run python scripts/simulate.py cooking \
    --image scripts/assets/onions.jpg \
    --recipe "Chicken Curry" \
    --step "Sauté onions until golden" \
    --watch-for "onions turning golden at edges" \
    --criticality high

  # Chat
  uv run python scripts/simulate.py chat --message "What can I make with eggs and flour?"

  # Send frames continuously from a directory of images (simulates real session)
  uv run python scripts/simulate.py loop --images-dir scripts/assets/ --interval 5
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import sys
import time
from pathlib import Path

import websockets
from PIL import Image, ImageDraw


WS_URL = "ws://localhost:8420/ws"


# --- Helpers ---

def make_envelope(msg_type: str, payload: dict) -> str:
    return json.dumps({"type": msg_type, "payload": payload, "timestamp": time.time()})


def image_to_b64(path: Path | None, size: tuple = (640, 480)) -> str:
    """Load image from path, or generate a test pattern if no path given."""
    if path and path.exists():
        img = Image.open(path).convert("RGB").resize(size)
    else:
        # Generate a colourful test pattern with text
        img = Image.new("RGB", size, color=(60, 80, 120))
        draw = ImageDraw.Draw(img)
        draw.rectangle([100, 100, 540, 380], fill=(200, 180, 140))
        draw.text((200, 220), "TEST FRAME", fill=(30, 30, 30))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode()


def make_context(
    phase: str = "discovery",
    session_id: str = "sim-001",
    current_step: int = 0,
    step_instruction: str = "",
    expected_visual_state: str = "",
    watch_for: str = "",
    criticality: str = "medium",
    recipe_title: str = "",
    discovered_items: list[str] | None = None,
) -> dict:
    return {
        "session_id": session_id,
        "phase": phase,
        "current_step": current_step,
        "step_instruction": step_instruction,
        "expected_visual_state": expected_visual_state,
        "watch_for": watch_for,
        "criticality": criticality,
        "recipe_title": recipe_title,
        "discovered_items": discovered_items or [],
    }


async def listen(ws, timeout: float = 30.0):
    """Print all server messages until timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        remaining = deadline - time.time()
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=min(remaining, 2.0))
            msg = json.loads(raw)
            print(f"\n← [{msg['type']}]")
            payload = msg.get("payload", {})
            # Pretty-print without huge byte fields
            for k, v in payload.items():
                if isinstance(v, str) and len(v) > 200:
                    print(f"   {k}: <{len(v)} chars>")
                else:
                    print(f"   {k}: {v}")
        except asyncio.TimeoutError:
            continue
        except websockets.exceptions.ConnectionClosed:
            print("Connection closed by server.")
            break


# --- Commands ---

async def cmd_discovery(args):
    image_b64 = image_to_b64(Path(args.image) if args.image else None)
    context = make_context(phase="discovery")

    async with websockets.connect(WS_URL, max_size=10 * 1024 * 1024) as ws:
        print(f"Connected. Sending discovery frame ({len(image_b64)} b64 chars)...")
        await ws.send(make_envelope("frame", {
            "timestamp": time.time(),
            "frame_bytes": image_b64,
            "frame_hash": "",
            "context": context,
        }))
        await listen(ws, timeout=args.timeout)


async def cmd_cooking(args):
    image_b64 = image_to_b64(Path(args.image) if args.image else None)
    context = make_context(
        phase="cooking",
        recipe_title=args.recipe,
        step_instruction=args.step,
        expected_visual_state=args.expected or "",
        watch_for=args.watch_for or "",
        criticality=args.criticality,
    )

    async with websockets.connect(WS_URL, max_size=10 * 1024 * 1024) as ws:
        print(f"Connected. Sending cooking frame (step='{args.step}')...")
        await ws.send(make_envelope("frame", {
            "timestamp": time.time(),
            "frame_bytes": image_b64,
            "frame_hash": "",
            "context": context,
        }))
        await listen(ws, timeout=args.timeout)


async def cmd_chat(args):
    image_b64 = image_to_b64(Path(args.image) if args.image else None) if args.image else None

    async with websockets.connect(WS_URL, max_size=10 * 1024 * 1024) as ws:
        print(f"Connected. Sending chat: {args.message!r}")
        payload = {"text": args.message}
        if image_b64:
            payload["image_bytes"] = image_b64
        await ws.send(make_envelope("chat", payload))
        await listen(ws, timeout=args.timeout)


async def cmd_loop(args):
    """Send frames continuously from a directory, cycling through images."""
    images_dir = Path(args.images_dir)
    images = sorted(images_dir.glob("*.jpg")) + sorted(images_dir.glob("*.png"))
    if not images:
        print(f"No images found in {images_dir}. Using test pattern.")
        images = [None]

    context = make_context(phase=args.phase)
    interval = args.interval

    async with websockets.connect(WS_URL, max_size=10 * 1024 * 1024) as ws:
        print(f"Connected. Looping {len(images)} image(s) every {interval}s. Ctrl+C to stop.")

        async def sender():
            i = 0
            while True:
                img_path = images[i % len(images)]
                image_b64 = image_to_b64(img_path)
                label = img_path.name if img_path else "test-pattern"
                print(f"\n→ [frame] {label} phase={context['phase']}")
                await ws.send(make_envelope("frame", {
                    "timestamp": time.time(),
                    "frame_bytes": image_b64,
                    "frame_hash": "",
                    "context": context,
                }))
                i += 1
                await asyncio.sleep(interval)

        await asyncio.gather(sender(), listen(ws, timeout=args.timeout))


# --- CLI ---

def main():
    parser = argparse.ArgumentParser(description="Cookie server simulator")
    parser.add_argument("--url", default=WS_URL, help="WebSocket URL")
    parser.add_argument("--timeout", type=float, default=30.0, help="How long to wait for responses")
    sub = parser.add_subparsers(dest="command", required=True)

    # discovery
    p = sub.add_parser("discovery", help="Send a single discovery frame")
    p.add_argument("--image", help="Path to JPEG/PNG image (optional)")

    # cooking
    p = sub.add_parser("cooking", help="Send a single cooking frame")
    p.add_argument("--image", help="Path to JPEG/PNG image (optional)")
    p.add_argument("--recipe", default="Test Recipe", help="Recipe title")
    p.add_argument("--step", default="Chop the onions", help="Current step instruction")
    p.add_argument("--expected", default="", help="Expected visual state")
    p.add_argument("--watch-for", default="", help="What to watch for")
    p.add_argument("--criticality", default="medium", choices=["low", "medium", "high"])

    # chat
    p = sub.add_parser("chat", help="Send a chat message")
    p.add_argument("message", help="Chat message text")
    p.add_argument("--image", help="Optional image path")

    # loop
    p = sub.add_parser("loop", help="Send frames continuously")
    p.add_argument("--images-dir", default="scripts/assets", help="Directory of images to cycle through")
    p.add_argument("--interval", type=float, default=5.0, help="Seconds between frames")
    p.add_argument("--phase", default="discovery", choices=["discovery", "cooking"])
    p.add_argument("--timeout", type=float, default=300.0)

    args = parser.parse_args()

    commands = {
        "discovery": cmd_discovery,
        "cooking": cmd_cooking,
        "chat": cmd_chat,
        "loop": cmd_loop,
    }

    asyncio.run(commands[args.command](args))


if __name__ == "__main__":
    main()
