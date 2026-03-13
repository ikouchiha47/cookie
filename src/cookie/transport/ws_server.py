"""WebSocket transport server handling edge device connections.

A minimal HTTP server runs on port+1 (default 8421) for out-of-band control
requests that may arrive when the WebSocket is unavailable.

Supported HTTP routes:
    POST /sessions/{session_id}/abort  →  202 | 404
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Coroutine

import websockets
from websockets.asyncio.server import Server, ServerConnection
from websockets.exceptions import ConnectionClosed

from cookie.models import (
    ChatResponse,
    CookingObservation,
    DiscoveryMessage,
    Envelope,
    GuidanceMessage,
    QueryMessage,
    StepUpdate,
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

    async def send_plan_update(self, amended_steps: list[dict]):
        """Push amended step definitions to the client so future frames carry updated context."""
        await self._send(Envelope(type="plan_update", payload={"steps": amended_steps}))

    async def send_session_init(self):
        """Send server-assigned session_id to client immediately on connect."""
        await self._send(Envelope(type="session_init", payload={"session_id": self.session_id}))

    async def send_aborted(self):
        """Confirm abort to client — they should reset UI and stop sending frames."""
        await self._send(Envelope(type="aborted", payload={}))


ConnectHandler = Callable[["ClientSession"], Coroutine[Any, Any, None]]
DisconnectHandler = Callable[["ClientSession"], Coroutine[Any, Any, None]]
# HTTP abort handler: (session_id) → (status_code, body_bytes)
HttpAbortHandler = Callable[[str], Coroutine[Any, Any, tuple[int, bytes]]]


class TransportServer:
    def __init__(self, host: str = "0.0.0.0", port: int = 8420):
        self.host = host
        self.port = port
        self.sessions: dict[str, ClientSession] = {}
        self._handlers: dict[str, MessageHandler] = {}
        self._connect_handler: ConnectHandler | None = None
        self._disconnect_handler: DisconnectHandler | None = None
        self._http_abort_handler: HttpAbortHandler | None = None
        self._server: Server | None = None
        self._http_server: asyncio.AbstractServer | None = None
        self._next_session_id = 0

    def on_http_abort(self, handler: HttpAbortHandler):
        """Register a handler for POST /sessions/{id}/abort HTTP requests."""
        self._http_abort_handler = handler

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
                except ConnectionClosed:
                    break
                except Exception:
                    log.exception("Error processing message")
        except ConnectionClosed:
            pass  # clean or unclean disconnect — not an error
        finally:
            if self._disconnect_handler:
                await self._disconnect_handler(session)
            del self.sessions[session_id]
            log.info("Client disconnected: %s", session_id)

    async def _handle_http(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """Minimal HTTP/1.1 handler for control requests (abort, health).

        Reads the request line + headers, routes POST /sessions/{id}/abort,
        returns 405 for everything else. No body parsing needed — abort carries
        no payload.
        """
        try:
            request_line = (await reader.readline()).decode().strip()
            if not request_line:
                return
            parts = request_line.split()
            if len(parts) < 2:
                return
            method, path = parts[0], parts[1]

            # Consume headers (required before writing response)
            while True:
                line = await reader.readline()
                if line in (b"\r\n", b"\n", b""):
                    break

            # Route: POST /sessions/{session_id}/abort
            path_parts = path.strip("/").split("/")
            if (
                method == "POST"
                and len(path_parts) == 3
                and path_parts[0] == "sessions"
                and path_parts[2] == "abort"
            ):
                session_id = path_parts[1]
                log.info("HTTP abort [%s]", session_id)
                if self._http_abort_handler:
                    status_code, body = await self._http_abort_handler(session_id)
                else:
                    status_code, body = 503, b'{"error":"abort handler not configured"}'
            else:
                status_code, body = 405, b'{"error":"method not allowed"}'

            reason = {202: "Accepted", 404: "Not Found", 405: "Method Not Allowed",
                      503: "Service Unavailable"}.get(status_code, "OK")
            response = (
                f"HTTP/1.1 {status_code} {reason}\r\n"
                f"Content-Type: application/json\r\n"
                f"Content-Length: {len(body)}\r\n"
                f"Connection: close\r\n\r\n"
            ).encode() + body
            writer.write(response)
            await writer.drain()
        except Exception:
            log.exception("HTTP handler error")
        finally:
            writer.close()

    async def start(self):
        self._server = await websockets.serve(
            self._handle_connection,
            self.host,
            self.port,
            max_size=10 * 1024 * 1024,
        )
        http_port = self.port + 1
        self._http_server = await asyncio.start_server(
            self._handle_http, self.host, http_port
        )
        log.info("WS listening on %s:%d  HTTP control on %s:%d",
                 self.host, self.port, self.host, http_port)

    async def stop(self):
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        if self._http_server:
            self._http_server.close()
            await self._http_server.wait_closed()
