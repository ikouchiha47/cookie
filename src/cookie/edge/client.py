"""Edge client — captures frames + audio and streams to server."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import websockets

from cookie.config import load_config
from cookie.models import AudioMessage, Envelope, FrameMessage, GuidanceMessage

from .audio_capture import AudioCapture
from .frame_sampler import FrameSampler

log = logging.getLogger(__name__)


class EdgeClient:
    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or load_config()
        edge_cfg = self.config.get("edge", {})
        self.sampler = FrameSampler(edge_cfg.get("frame_sampling", {}))
        self.audio = AudioCapture(edge_cfg.get("audio", {}))

        server_cfg = self.config.get("server", {})
        self.server_url = f"ws://{server_cfg.get('host', 'localhost')}:{server_cfg.get('port', 8420)}/ws"

        cam_cfg = edge_cfg.get("camera", {})
        self.fps = cam_cfg.get("fps", 3)
        self.resolution = tuple(cam_cfg.get("resolution", [640, 480]))
        self.jpeg_quality = cam_cfg.get("jpeg_quality", 80)

        self._ws = None
        self._running = False

    async def connect(self):
        self._ws = await websockets.connect(self.server_url, max_size=10 * 1024 * 1024)
        log.info("Connected to server at %s", self.server_url)

    async def _send(self, msg_type: str, payload: dict):
        envelope = Envelope(type=msg_type, payload=payload)
        await self._ws.send(envelope.model_dump_json())

    async def _receive_loop(self):
        """Listen for server messages and handle them."""
        async for raw in self._ws:
            envelope = Envelope.model_validate_json(raw)
            if envelope.type == "guidance":
                msg = GuidanceMessage(**envelope.payload)
                self._handle_guidance(msg)
            elif envelope.type == "step_update":
                log.info("Step update: %s", envelope.payload)
            elif envelope.type == "query":
                log.info("Server asks: %s", envelope.payload.get("question"))

    def _handle_guidance(self, msg: GuidanceMessage):
        severity_prefix = {"info": "", "warning": "WARNING: ", "critical": "ALERT: "}
        print(f"\n🍳 {severity_prefix.get(msg.severity, '')}{msg.text}\n")
        if msg.tts_audio_bytes:
            # TODO: play TTS audio via piper or system audio
            pass

    async def run_camera_loop(self):
        """Capture frames from camera and send changed ones."""
        import cv2

        cap = cv2.VideoCapture(0)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.resolution[0])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.resolution[1])
        interval = 1.0 / self.fps

        try:
            while self._running:
                ret, frame = cap.read()
                if not ret:
                    await asyncio.sleep(interval)
                    continue

                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                should_send, frame_hash = self.sampler.should_send(frame_rgb)

                if should_send:
                    jpeg_bytes = self.sampler.encode_jpeg(frame_rgb, self.jpeg_quality)
                    await self._send(
                        "frame",
                        FrameMessage(
                            frame_bytes=jpeg_bytes,
                            frame_hash=frame_hash,
                        ).model_dump(),
                    )

                await asyncio.sleep(interval)
        finally:
            cap.release()

    async def run_audio_loop(self):
        """Capture audio and send chunks with speech."""
        try:
            self.audio.open_stream()
        except Exception:
            log.warning("No audio input available, skipping audio capture")
            return

        try:
            while self._running:
                chunk = await asyncio.to_thread(self.audio.read_chunk)
                is_speech = self.audio.detect_speech(chunk)
                if is_speech:
                    await self._send(
                        "audio",
                        AudioMessage(audio_bytes=chunk, is_speech=True).model_dump(),
                    )
        finally:
            self.audio.close()

    async def run(self):
        await self.connect()
        self._running = True
        await asyncio.gather(
            self.run_camera_loop(),
            self.run_audio_loop(),
            self._receive_loop(),
        )

    async def stop(self):
        self._running = False
        if self._ws:
            await self._ws.close()


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Cookie edge client")
    parser.add_argument("--config", help="Path to config YAML")
    parser.add_argument("--server", help="Server URL override (ws://host:port/ws)")
    args = parser.parse_args()

    config = load_config(args.config)
    client = EdgeClient(config)
    if args.server:
        client.server_url = args.server

    asyncio.run(client.run())


if __name__ == "__main__":
    main()
