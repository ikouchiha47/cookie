/**
 * Character Registry
 *
 * Register characters here. To add a new one:
 * 1. Create src/characters/<name>/expressions.ts  (expression map)
 * 2. Create src/characters/<name>/index.tsx       (renderer component)
 * 3. Register it below
 *
 * The active character is read from AsyncStorage so it persists across sessions.
 * Default is "robot".
 */

import type { CharacterRenderer, ExpressionName, ExpressionParams } from "./protocol";
import { DEFAULT_PARAMS } from "./protocol";
import { ROBOT_EXPRESSIONS } from "./robot/expressions";
import { RobotCharacter } from "./robot";

// ─── Merge helper ──────────────────────────────────────────────────────────────
// Merges expression-specific overrides on top of DEFAULT_PARAMS.
function buildParams(
  expression: ExpressionName,
  map: Record<ExpressionName, Partial<ExpressionParams>>
): ExpressionParams {
  return { ...DEFAULT_PARAMS, ...(map[expression] ?? {}) };
}

// ─── Robot ─────────────────────────────────────────────────────────────────────
const robotRenderer: CharacterRenderer = {
  id: "robot",
  name: "Cookie",
  getParams: (expr) => buildParams(expr, ROBOT_EXPRESSIONS),
  Component: RobotCharacter,
};

// ─── Registry ──────────────────────────────────────────────────────────────────
const CHARACTERS: Record<string, CharacterRenderer> = {
  robot: robotRenderer,
  // herb: herbRenderer,     <- add when built
  // spatula: spatulaRenderer,
};

export function getCharacter(id: string): CharacterRenderer {
  return CHARACTERS[id] ?? robotRenderer;
}

export function listCharacters(): CharacterRenderer[] {
  return Object.values(CHARACTERS);
}
