/**
 * Character Engine — Mapping Layer
 *
 * Converts normalized ExpressionParams (-1→1, 0→1) into concrete
 * ResolvedControls using the CharacterSchema's declared ranges.
 *
 * This is the only place that knows about the semantic meaning of
 * ExpressionParams values. Renderers only see ResolvedControls.
 */

import type { ExpressionParams } from "../protocol";
import type { CharacterSchema, ResolvedControls } from "./types";

// ─── Math helpers ─────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Map a normalized value (-1→1) to a range */
function mapNorm(v: number, min: number, max: number): number {
  const t = (clamp(v, -1, 1) + 1) / 2;
  return lerp(min, max, t);
}

/** Map a 0→1 value to a range */
function map01(v: number, min: number, max: number): number {
  return lerp(min, max, clamp(v, 0, 1));
}

// ─── Brow angle derivation ────────────────────────────────────────────────────
// Derived from mouthCurve + eyeOpenness combo.
// No explicit brow param in ExpressionParams — brows follow the emotion.

function deriveBrowAngles(p: ExpressionParams): { left: number; right: number } {
  const isAngry   = p.eyeOpenness < 0.5 && p.mouthCurve < -0.5;
  const isSad     = p.mouthCurve < -0.3 && !isAngry;
  const isHappy   = p.mouthCurve > 0.3;
  const isSurprise = p.eyeOpenness > 1.1;

  if (isAngry) {
    // angry: \ /  (left positive, right negative — inner corners down)
    const intensity = clamp((-p.mouthCurve - 0.5) / 0.5, 0, 1);
    return { left: 28 * intensity, right: -28 * intensity };
  }
  if (isSad) {
    // sad/concerned: / \  (left negative, right positive — inner corners up)
    const intensity = clamp((-p.mouthCurve - 0.3) / 0.7, 0, 1);
    return { left: -22 * intensity, right: 22 * intensity };
  }
  if (isSurprise) {
    // surprised: raised flat brows
    return { left: -8, right: 8 };
  }
  if (isHappy) {
    // happy: slightly raised inner corners
    const intensity = clamp((p.mouthCurve - 0.3) / 0.7, 0, 1);
    return { left: -6 * intensity, right: 6 * intensity };
  }
  return { left: 0, right: 0 };
}

// ─── Eye color ────────────────────────────────────────────────────────────────

function deriveEyeColor(p: ExpressionParams): string {
  if (p.antennaLight === "alert" || p.screenTint != null) return "#E05040";
  return "#5BC8E8";
}

// ─── Main mapping function ────────────────────────────────────────────────────

export function mapParamsToControls(
  p: ExpressionParams,
  schema: CharacterSchema
): ResolvedControls {
  const sc = schema.controls;
  const browAngles = deriveBrowAngles(p);
  const eyeColor = deriveEyeColor(p);

  // ── brows ──────────────────────────────────────────────────────────────────
  const lbRange = sc.brows.left.range;
  const rbRange = sc.brows.right.range;
  const leftBrowAngle  = clamp(browAngles.left,  lbRange.min, lbRange.max);
  const rightBrowAngle = clamp(browAngles.right, rbRange.min, rbRange.max);

  // ── eyes ───────────────────────────────────────────────────────────────────
  const le = sc.eyes.left;
  const re = sc.eyes.right;

  const lScaleY = map01(p.eyeOpenness,      le.opennessRange.min, le.opennessRange.max);
  const rScaleY = map01(p.eyeRightOpenness, re.opennessRange.min, re.opennessRange.max);

  const lookDX = mapNorm(p.eyeLookX, le.lookXRange.min, le.lookXRange.max);
  const lookDY = mapNorm(p.eyeLookY, le.lookYRange.min, le.lookYRange.max);

  // ── mouth ──────────────────────────────────────────────────────────────────
  const mc = sc.mouth;
  let mouthShape: ResolvedControls["mouth"]["shape"] = "bezier";
  let controlY = mc.controlY_rest;
  let openRy = 0;

  if (p.mouthShape === "open") {
    mouthShape = "open";
    openRy = Math.max(2, (mc.controlY_max - mc.y) * 0.55 * clamp(p.mouthOpen, 0, 1));
  } else if (p.mouthCurve === 0 && p.mouthOpen === 0) {
    mouthShape = "flat";
  } else {
    mouthShape = "bezier";
    controlY = mapNorm(p.mouthCurve, mc.controlY_min, mc.controlY_max);
  }

  // ── signal ─────────────────────────────────────────────────────────────────
  const sigColors = sc.signal.colors;
  const signalColor = sigColors[p.antennaLight as keyof typeof sigColors] ?? sigColors.idle;
  const glowRadius = p.pulseSpeed > 0
    ? map01(clamp(p.pulseSpeed / 3, 0, 1), sc.signal.glowRange.min, sc.signal.glowRange.max)
    : 0;

  return {
    brows: {
      left:  { angle: leftBrowAngle },
      right: { angle: rightBrowAngle },
    },
    eyes: {
      left:  { scaleY: lScaleY, dx: lookDX, dy: lookDY, color: eyeColor },
      right: { scaleY: rScaleY, dx: -lookDX, dy: lookDY, color: eyeColor },
    },
    mouth: { shape: mouthShape, controlY, openRy },
    signal: { color: signalColor, glowRadius },
    overlay: {
      screenTint: p.screenTint ?? null,
      blush:      p.blush,
      tearDrop:   p.tearDrop,
      sweatDrop:  p.sweatDrop,
      heartFloat: p.heartFloat,
    },
  };
}
