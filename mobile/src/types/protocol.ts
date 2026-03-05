/** Wire protocol types — mirrors src/cookie/models.py */

// --- Enums ---

export type Severity = "info" | "warning" | "critical";
export type StepStatus = "pending" | "active" | "done" | "skipped";
export type EventType = "object_detected" | "state_change" | "color_shift" | "action";
export type SpeechIntent = "question" | "statement" | "confirmation";
export type SceneEventType = "boundary" | "continuation";
export type InterruptType = "voice" | "button";

// --- Edge → Server Messages ---

export interface FrameMessage {
  timestamp: number;
  frame_bytes: string; // base64
  frame_hash: string;
}

export interface AudioMessage {
  timestamp: number;
  audio_bytes: string; // base64
  is_speech: boolean;
}

export interface UserInterrupt {
  timestamp: number;
  type: InterruptType;
  text?: string;
}

// --- Server → Edge Messages ---

export interface GuidanceMessage {
  text: string;
  severity: Severity;
  expression: string; // ExpressionName — "other"/unknown treated as "default"
  tts_audio_bytes?: string; // base64
}

export interface StepUpdate {
  step_index: number;
  status: StepStatus;
}

export interface QueryMessage {
  question: string;
  expects: "confirm" | "freeform";
}

// --- Discovery ---

export interface RecipeSuggestion {
  name: string;
  description: string;
  confidence: "high" | "medium" | "low";
}

export interface DiscoveryMessage {
  items: string[];
  suggestions: RecipeSuggestion[];
}

// --- Chat ---

export interface ChatResponse {
  text: string;
  items: string[];
  suggestions: RecipeSuggestion[];
  recipe_plan?: RecipePlan;
}

// --- Recipe Models ---

export interface SensoryCheckpoint {
  description: string;
  camera_verifiable: boolean;
}

export interface CommonMistake {
  description: string;
  detection: string;
  recovery: string;
}

export interface RecipeStep {
  index: number;
  instruction: string;
  quantities: Record<string, string>;
  duration_seconds?: number;
  sensory_checkpoints: SensoryCheckpoint[];
  common_mistakes: CommonMistake[];
  safety_thresholds: Record<string, string>;
  expected_visual_state: string;
}

export interface RecipePlan {
  title: string;
  servings: number;
  steps: RecipeStep[];
  total_time_minutes?: number;
}

// --- Session State ---

export interface UserProfile {
  allergies: string[];
  conditions: string[];
  household: string[];
  skill_level: string;
}

// --- Transport Envelope ---

export interface Envelope {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}
