/** Encode/decode Envelope — mirrors models.py Envelope */

import type { Envelope } from "../types/protocol";

export function encode(type: string, payload: Record<string, unknown>): string {
  const envelope: Envelope = {
    type,
    payload,
    timestamp: Date.now() / 1000,
  };
  return JSON.stringify(envelope);
}

export function decode(raw: string): Envelope {
  return JSON.parse(raw) as Envelope;
}
