"""SQL constants for the sessions table."""

UPSERT = """
INSERT INTO sessions (session_id, started_at, phase, recipe_plan_json)
VALUES (?, ?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
    phase            = excluded.phase,
    recipe_plan_json = COALESCE(excluded.recipe_plan_json, recipe_plan_json)
"""

GET_BY_ID = """
SELECT * FROM sessions WHERE session_id = ?
"""

MARK_ABORTED = """
UPDATE sessions SET status = 'aborted', aborted_at = ? WHERE session_id = ?
"""
