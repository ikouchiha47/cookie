/** WebSocket service with auto-reconnect */

import { encode, decode } from "./envelope";
import type { Envelope } from "../types/protocol";

type MessageHandler = (envelope: Envelope) => void;

export class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: MessageHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;
  private _onStatusChange?: (status: "disconnected" | "connecting" | "connected") => void;

  constructor(url: string) {
    this.url = url;
  }

  set onStatusChange(fn: (status: "disconnected" | "connecting" | "connected") => void) {
    this._onStatusChange = fn;
  }

  setUrl(url: string) {
    if (this.url === url) return;
    this.url = url;
    // Reconnect with the new URL
    if (this.ws) {
      this.shouldReconnect = false;
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.shouldReconnect = true;
    this.connect();
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.shouldReconnect = true;
    this._onStatusChange?.("connecting");

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this._onStatusChange?.("connected");
    };

    this.ws.onmessage = (event) => {
      try {
        const envelope = decode(event.data as string);
        for (const handler of this.handlers) {
          handler(envelope);
        }
      } catch (e) {
        console.warn("[WS] Failed to decode message:", e);
      }
    };

    this.ws.onclose = () => {
      this._onStatusChange?.("disconnected");
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  send(type: string, payload: Record<string, unknown>) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(encode(type, payload));
    return true;
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this._onStatusChange?.("disconnected");
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }
}

/** Singleton instance */
export const wsService = new WebSocketService(
  process.env.EXPO_PUBLIC_WS_URL ?? "ws://localhost:8420/ws"
);
