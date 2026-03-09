/**
 * Frame change detector.
 *
 * JPEG base64 has a ~1000-char header that's always identical.
 * We skip it and split the remaining content into 4 regions,
 * hashing each independently. If ANY region changes by more than
 * the threshold, we consider the frame different enough to send.
 */

const JPEG_HEADER_B64_LEN = 1000; // ~750 bytes of JPEG header in base64

function hashRegion(s: string, start: number, end: number): number {
  let h = 0x811c9dc5; // FNV-1a init
  const step = Math.max(1, Math.floor((end - start) / 128));
  for (let i = start; i < end; i += step) {
    h ^= s.charCodeAt(i);
    h = (Math.imul(h, 0x01000193)) >>> 0; // FNV prime, keep 32-bit
  }
  return h;
}

export class FrameSampler {
  private minIntervalMs: number;
  private changeThreshold: number; // 0–1, fraction of regions that must change
  private lastHashes: number[] | null = null;
  private lastSendTime = 0;

  constructor(config?: { phash_threshold?: number; min_interval_ms?: number }) {
    this.minIntervalMs = config?.min_interval_ms ?? 200;
    // phash_threshold repurposed: number of regions (out of 4) that must change
    this.changeThreshold = Math.min(4, config?.phash_threshold ?? 1);
  }

  private computeHashes(b64: string): number[] {
    const start = Math.min(JPEG_HEADER_B64_LEN, Math.floor(b64.length * 0.15));
    const content = b64.length - start;
    if (content <= 0) return [hashRegion(b64, 0, b64.length)];
    const regionSize = Math.floor(content / 4);
    return [0, 1, 2, 3].map((i) =>
      hashRegion(b64, start + i * regionSize, start + (i + 1) * regionSize)
    );
  }

  shouldSend(b64: string): { send: boolean; hash: string } {
    const now = Date.now();
    const hashes = this.computeHashes(b64);
    const hash = hashes.map((h) => h.toString(16).padStart(8, "0")).join("");

    if (now - this.lastSendTime < this.minIntervalMs) {
      return { send: false, hash };
    }

    if (!this.lastHashes) {
      this.lastHashes = hashes;
      this.lastSendTime = now;
      return { send: true, hash };
    }

    const changedRegions = hashes.filter((h, i) => h !== this.lastHashes![i]).length;
    const changed = changedRegions >= this.changeThreshold;

    if (changed) {
      this.lastHashes = hashes;
      this.lastSendTime = now;
    }

    return { send: changed, hash };
  }

  reset(): void {
    this.lastHashes = null;
    this.lastSendTime = 0;
  }
}
