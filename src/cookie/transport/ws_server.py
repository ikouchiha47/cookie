"""WebSocket transport server handling edge device connections."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Coroutine

import websockets
from websockets.asyncio.server import Server, ServerConnection

from cookie.models import (
    AudioMessage,
    ChatResponse,
    DiscoveryMessage,
    Envelope,
    FrameMessage,
    GuidanceMessage,
    QueryMessage,
    StepUpdate,
    UserInterrupt,
)

log = logging.getLogger(__name__)

# Type for message handlers
MessageHandler = Callable[[str, dict, "ClientSession"], Coroutine[Any, Any, None]]


class ClientSession:
    """Represents a connected edge client."""

    def __init__(self, ws: ServerConnection, session_id: str):
        self.ws = ws
        self.session_id = session_id

    async def send_guidance(self, msg: GuidanceMessage):
        envelope = Envelope(type="guidance", payload=msg.model_dump())
        await self.ws.send(envelope.model_dump_json())

    async def send_step_update(self, msg: StepUpdate):
        envelope = Envelope(type="step_update", payload=msg.model_dump())
        await self.ws.send(envelope.model_dump_json())

    async def send_query(self, msg: QueryMessage):
        envelope = Envelope(type="query", payload=msg.model_dump())
        await self.ws.send(envelope.model_dump_json())

    async def send_thinking(self):
        envelope = Envelope(type="thinking", payload={})
        await self.ws.send(envelope.model_dump_json())

    async def send_discovery(self, msg: DiscoveryMessage):
        envelope = Envelope(type="discovery", payload=msg.model_dump())
        await self.ws.send(envelope.model_dump_json())

    async def send_chat_response(self, msg: ChatResponse):
        envelope = Envelope(type="chat_response", payload=msg.model_dump())
        await self.ws.send(envelope.model_dump_json())


class TransportServer:
    def __init__(self, host: str = "0.0.0.0", port: int = 8420):
        self.host = host
        self.port = port
        self.sessions: dict[str, ClientSession] = {}
        self._handlers: dict[str, MessageHandler] = {}
        self._server: Server | None = None
        self._next_session_id = 0

    def on_message(self, msg_type: str, handler: MessageHandler):
        """Register a handler for a message type."""
        self._handlers[msg_type] = handler

    async def _handle_connection(self, ws: ServerConnection):
        session_id = f"session-{self._next_session_id}"
        self._next_session_id += 1
        session = ClientSession(ws, session_id)
        self.sessions[session_id] = session
        log.info("Client connected: %s", session_id)

        try:
            async for raw in ws:
                try:
                    envelope = Envelope.model_validate_json(raw)
                    handler = self._handlers.get(envelope.type)
                    if handler:
                        await handler(envelope.type, envelope.payload, session)
                    else:
                        log.warning("No handler for message type: %s", envelope.type)
                except Exception:
                    log.exception("Error processing message")
        finally:
            del self.sessions[session_id]
            log.info("Client disconnected: %s", session_id)

    async def start(self):
        self._server = await websockets.serve(
            self._handle_connection,
            self.host,
            self.port,
            max_size=10 * 1024 * 1024,
        )
        log.info("Transport server listening on %s:%d", self.host, self.port)

    async def stop(self):
        if self._server:
            self._server.close()
            await self._server.wait_closed()
