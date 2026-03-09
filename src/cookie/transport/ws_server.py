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
    CookingObservation,
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

    async def _send(self, envelope: Envelope):
        data = envelope.model_dump_json()
        log.info("← [%s] type=%s size=%d bytes", self.session_id, envelope.type, len(data))
        await self.ws.send(data)

    async def send_guidance(self, msg: GuidanceMessage):
        await self._send(Envelope(type="guidance", payload=msg.model_dump()))

    async def send_step_update(self, msg: StepUpdate):
        await self._send(Envelope(type="step_update", payload=msg.model_dump()))

    async def send_query(self, msg: QueryMessage):
        await self._send(Envelope(type="query", payload=msg.model_dump()))

    async def send_thinking(self):
        await self._send(Envelope(type="thinking", payload={}))

    async def send_discovery(self, msg: DiscoveryMessage):
        log.info("← [%s] discovery: items=%s", self.session_id, msg.items)
        await self._send(Envelope(type="discovery", payload=msg.model_dump()))

    async def send_cooking_observation(self, msg: CookingObservation):
        await self._send(Envelope(type="cooking_observation", payload=msg.model_dump()))

    async def send_chat_response(self, msg: ChatResponse):
        await self._send(Envelope(type="chat_response", payload=msg.model_dump()))


ConnectHandler = Callable[["ClientSession"], Coroutine[Any, Any, None]]
DisconnectHandler = Callable[["ClientSession"], Coroutine[Any, Any, None]]


class TransportServer:
    def __init__(self, host: str = "0.0.0.0", port: int = 8420):
        self.host = host
        self.port = port
        self.sessions: dict[str, ClientSession] = {}
        self._handlers: dict[str, MessageHandler] = {}
        self._connect_handler: ConnectHandler | None = None
        self._disconnect_handler: DisconnectHandler | None = None
        self._server: Server | None = None
        self._next_session_id = 0

    def on_connect(self, handler: ConnectHandler):
        self._connect_handler = handler

    def on_disconnect(self, handler: DisconnectHandler):
        self._disconnect_handler = handler

    def on_message(self, msg_type: str, handler: MessageHandler):
        """Register a handler for a message type."""
        self._handlers[msg_type] = handler

    async def _handle_connection(self, ws: ServerConnection):
        session_id = f"session-{self._next_session_id}"
        self._next_session_id += 1
        session = ClientSession(ws, session_id)
        self.sessions[session_id] = session
        log.info("Client connected: %s", session_id)
        if self._connect_handler:
            await self._connect_handler(session)

        try:
            async for raw in ws:
                try:
                    envelope = Envelope.model_validate_json(raw)
                    size = len(raw)
                    log.info("→ [%s] type=%s size=%d bytes", session.session_id, envelope.type, size)
                    handler = self._handlers.get(envelope.type)
                    if handler:
                        await handler(envelope.type, envelope.payload, session)
                    else:
                        log.warning("No handler for message type: %s", envelope.type)
                except Exception:
                    log.exception("Error processing message")
        finally:
            if self._disconnect_handler:
                await self._disconnect_handler(session)
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
