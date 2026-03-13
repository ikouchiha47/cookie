/**
 * On-device SQLite session store.
 * Client is source of truth — server is stateless.
 *
 * WAL mode: better concurrent read performance, no full locks on writes.
 * Schema is append-only — always add columns, never remove.
 */

import * as SQLite from "expo-sqlite";

export interface SessionRow {
  session_id: string;
  phase: "discovery" | "cooking" | "paused" | "done";
  started_at: number;
  updated_at: number;
  recipe_title: string;
  recipe_plan_json: string | null;   // full RecipePlan JSON
  current_step: number;
  step_instruction: string;
  expected_visual_state: string;
  watch_for: string;
  criticality: "low" | "medium" | "high";
  discovered_items_json: string;     // JSON array of strings
}

let _db: SQLite.SQLiteDatabase | null = null;
let _persistTimer: ReturnType<typeof setTimeout> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync("cookie.db");

  // WAL mode — better write throughput, non-blocking reads
  await _db.execAsync("PRAGMA journal_mode = WAL;");
  await _db.execAsync("PRAGMA synchronous = NORMAL;"); // safe with WAL

  await _db.execAsync(`
    CREATE TABLE IF NOT EXISTS saved_recipes (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      title         TEXT NOT NULL,
      recipe_json   TEXT NOT NULL,
      modifications TEXT NOT NULL DEFAULT '',
      rating        INTEGER,
      notes         TEXT NOT NULL DEFAULT '',
      saved_at      INTEGER NOT NULL
    );
  `);

  await _db.execAsync(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id            TEXT PRIMARY KEY,
      phase                 TEXT NOT NULL DEFAULT 'discovery',
      started_at            INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL,
      recipe_title          TEXT NOT NULL DEFAULT '',
      recipe_plan_json      TEXT,
      current_step          INTEGER NOT NULL DEFAULT 0,
      step_instruction      TEXT NOT NULL DEFAULT '',
      expected_visual_state TEXT NOT NULL DEFAULT '',
      watch_for             TEXT NOT NULL DEFAULT '',
      criticality           TEXT NOT NULL DEFAULT 'medium',
      discovered_items_json TEXT NOT NULL DEFAULT '[]'
    );
  `);

  return _db;
}

/** Debounced upsert — coalesces rapid writes (e.g. vigilance updates at 3s intervals) into one write per 2s. */
export function upsertSessionDebounced(row: Partial<SessionRow> & { session_id: string }): void {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    upsertSession(row).catch(() => {});
    _persistTimer = null;
  }, 2000);
}

export async function upsertSession(row: Partial<SessionRow> & { session_id: string }): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO sessions (
        session_id, phase, started_at, updated_at,
        recipe_title, recipe_plan_json, current_step,
        step_instruction, expected_visual_state,
        watch_for, criticality, discovered_items_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        phase                 = excluded.phase,
        updated_at            = excluded.updated_at,
        recipe_title          = excluded.recipe_title,
        recipe_plan_json      = excluded.recipe_plan_json,
        current_step          = excluded.current_step,
        step_instruction      = excluded.step_instruction,
        expected_visual_state = excluded.expected_visual_state,
        watch_for             = excluded.watch_for,
        criticality           = excluded.criticality,
        discovered_items_json = excluded.discovered_items_json;`,
    [
      row.session_id,
      row.phase ?? "discovery",
      row.started_at ?? now,
      now,
      row.recipe_title ?? "",
      row.recipe_plan_json ?? null,
      row.current_step ?? 0,
      row.step_instruction ?? "",
      row.expected_visual_state ?? "",
      row.watch_for ?? "",
      row.criticality ?? "medium",
      row.discovered_items_json ?? "[]",
    ]
  );
}

export async function loadLatestIncompleteSession(): Promise<SessionRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SessionRow>(
    `SELECT * FROM sessions
     WHERE phase != 'done'
     ORDER BY updated_at DESC
     LIMIT 1;`
  );
  return row ?? null;
}

export async function markSessionDone(session_id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sessions SET phase = 'done', updated_at = ? WHERE session_id = ?;`,
    [Date.now(), session_id]
  );
}

export interface SavedRecipeRow {
  id: string;
  session_id: string;
  title: string;
  recipe_json: string;
  modifications: string;
  rating: number | null;
  notes: string;
  saved_at: number;
}

export async function saveRecipe(row: Omit<SavedRecipeRow, "id" | "saved_at">): Promise<string> {
  const db = await getDb();
  const id = `recipe_${Date.now()}`;
  const saved_at = Date.now();
  await db.runAsync(
    `INSERT INTO saved_recipes (id, session_id, title, recipe_json, modifications, rating, notes, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [id, row.session_id, row.title, row.recipe_json, row.modifications, row.rating ?? null, row.notes, saved_at]
  );
  return id;
}

export async function listSavedRecipes(limit = 50): Promise<SavedRecipeRow[]> {
  const db = await getDb();
  return db.getAllAsync<SavedRecipeRow>(
    `SELECT * FROM saved_recipes ORDER BY saved_at DESC LIMIT ?;`,
    [limit]
  );
}

export async function listSessions(limit = 20): Promise<SessionRow[]> {
  const db = await getDb();
  return db.getAllAsync<SessionRow>(
    `SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?;`,
    [limit]
  );
}
