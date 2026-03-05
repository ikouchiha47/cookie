/**
 * Character Expression Protocol
 *
 * This is the shared semantic contract between the LLM output and any
 * character renderer. Characters are swappable — as long as they implement
 * CharacterRenderer, any visual style works.
 *
 * The LLM / reasoning engine speaks in ExpressionNames.
 * Each character decides how to visually represent them.
 */

// ─── Canonical expression names ───────────────────────────────────────────────
// These are the only values the LLM/store should ever emit.
// Add new ones here first, then implement in each character.

export type ExpressionName =
  | "default"     // friendly waiting — slight smile, side-to-side eyes
  | "idle"        // unimpressed / neutral
  | "happy"       // delighted
  | "confused"    // asymmetric eyes
  | "sad"         // frown, tears
  | "angry"       // furious, red tint
  | "embarrassed" // blushing
  | "wink"        // cool wink
  | "concerned"   // worried / alarmed — covers warning + critical
  | "excited";    // big smile, heart float


// ─── Normalized expression parameters ────────────────────────────────────────
// All values are normalized (0–1 or -1–1) and character-agnostic.
// Each character maps these to its own visual vocabulary.

export interface ExpressionParams {
  // Eyes
  eyeOpenness: number;          // 0 = closed, 1 = fully open
  eyeRightOpenness: number;     // separate for wink/asymmetry
  eyeLookX: number;             // -1 = left, 0 = center, 1 = right
  eyeLookY: number;             // -1 = up, 0 = center, 1 = down
  eyeShape: EyeShape;
  eyeRightShape: EyeShape;      // can differ from left (wink, confused)

  // Mouth
  mouthCurve: number;           // -1 = frown, 0 = neutral, 1 = smile
  mouthOpen: number;            // 0 = closed, 1 = wide open
  mouthShape: MouthShape;

  // Body / face tone
  screenTint: string | null;    // null = character default; "#8B0000" angry, "#2d5a27" sick
  blush: boolean;               // rosy cheeks / embarrassed

  // Floating effects (optional overlay elements)
  sweatDrop: boolean;
  tearDrop: boolean;
  zzzFloat: boolean;            // sleep z's
  thoughtBubble: boolean;
  heartFloat: boolean;          // floating heart (love)

  // State
  antennaLight: AntennaLightState;
  pulseSpeed: number;           // 0 = none, higher = faster blink
  bodyBob: boolean;             // gentle idle bob animation
}

export type EyeShape =
  | "block"     // robot: filled rectangle
  | "circle"    // round eyes (herb)
  | "arc"       // closed/happy arc  ∪
  | "arcDown"   // sad arc  ∩
  | "heart"     // love
  | "cross"     // X eyes (dizzy)
  | "dot"       // small dot
  | "wide";     // oversized circle (surprised)

export type MouthShape =
  | "curve"     // default bezier
  | "open"      // O shape
  | "teeth"     // open with teeth line
  | "flat";     // straight line

export type AntennaLightState = "idle" | "excited" | "alert" | "error";


// ─── Default neutral params ───────────────────────────────────────────────────
// Baseline every character starts from — override what you need.

export const DEFAULT_PARAMS: ExpressionParams = {
  eyeOpenness: 0.85,
  eyeRightOpenness: 0.85,
  eyeLookX: 0,
  eyeLookY: 0,
  eyeShape: "block",
  eyeRightShape: "block",
  mouthCurve: 0.2,
  mouthOpen: 0,
  mouthShape: "curve",
  screenTint: null,
  blush: false,
  sweatDrop: false,
  tearDrop: false,
  zzzFloat: false,
  thoughtBubble: false,
  heartFloat: false,
  antennaLight: "idle",
  pulseSpeed: 0,
  bodyBob: false,
};


// ─── Expression map type ──────────────────────────────────────────────────────
// Each character exports one of these.

export type ExpressionMap = Record<ExpressionName, Partial<ExpressionParams>>;


// ─── Character renderer interface ────────────────────────────────────────────

export interface CharacterRenderer {
  /** Unique ID — used in settings / character selector */
  id: string;

  /** Display name */
  name: string;

  /** Return params for a given expression (merged on top of DEFAULT_PARAMS) */
  getParams(expression: ExpressionName): ExpressionParams;

  /** The React component that renders this character */
  Component: React.ComponentType<CharacterComponentProps>;
}

export interface CharacterComponentProps {
  params: ExpressionParams;
  size: number;
}
