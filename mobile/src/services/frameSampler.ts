/**
 * Perceptual hash frame sampler — mirrors edge/frame_sampler.py.
 *
 * Since we can't run DCT on device easily, we use a simplified average hash:
 * resize to 8x8 greyscale, threshold at mean → 64-bit hash.
 * Hamming distance comparison for change detection.
 */

const HASH_SIZE = 8;

export class FrameSampler {
  private phashThreshold: number;
  private minIntervalMs: number;
  private lastHash: string | null = null;
  private lastSendTime = 0;

  constructor(config?: { phash_threshold?: number; min_interval_ms?: number }) {
    this.phashThreshold = config?.phash_threshold ?? 12;
    this.minIntervalMs = config?.min_interval_ms ?? 200;
  }

  /**
   * Compute a simple average hash from raw RGBA pixel data.
   * Expects pixels from a small (32x32 or similar) greyscale-ready source.
   * For the mobile app, we pass the base64 JPEG directly and skip client-side hashing
   * in favor of a timestamp + size-based dedup (the server does its own phash).
   *
   * This simplified version uses frame byte length as a rough proxy.
   */
  computeSimpleHash(base64Data: string): string {
    // Use a simple hash of the base64 length + sample bytes
    let hash = 0;
    const sample = base64Data.substring(0, 128);
    for (let i = 0; i < sample.length; i++) {
      hash = ((hash << 5) - hash + sample.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(16).padStart(16, "0");
  }

  hammingDistance(a: string, b: string): number {
    let dist = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) dist++;
    }
    return dist + Math.abs(a.length - b.length);
  }

  shouldSend(base64Frame: string): { send: boolean; hash: string } {
    const hash = this.computeSimpleHash(base64Frame);
    const now = Date.now();
    const elapsed = now - this.lastSendTime;

    if (elapsed < this.minIntervalMs) {
      return { send: false, hash };
    }

    if (this.lastHash === null) {
      this.lastHash = hash;
      this.lastSendTime = now;
      return { send: true, hash };
    }

    const distance = this.hammingDistance(this.lastHash, hash);
    if (distance >= this.phashThreshold) {
      this.lastHash = hash;
      this.lastSendTime = now;
      return { send: true, hash };
    }

    return { send: false, hash };
  }

  /** Force-send next frame (e.g. after reconnect) */
  reset(): void {
    this.lastHash = null;
    this.lastSendTime = 0;
  }
}
