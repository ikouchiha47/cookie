"""SQL constants for the plan_state table."""

UPSERT_STEP = """
INSERT INTO plan_state
    (session_id, step_index, instruction, expected_visual_state,
     expected_texture, expected_taste_smell, status, amended_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id, step_index) DO UPDATE SET
    instruction           = excluded.instruction,
    expected_visual_state = excluded.expected_visual_state,
    expected_texture      = excluded.expected_texture,
    expected_taste_smell  = excluded.expected_taste_smell,
    status                = excluded.status,
    amended_at            = excluded.amended_at
"""

GET_PLAN = """
SELECT * FROM plan_state WHERE session_id = ? ORDER BY step_index ASC
"""

GET_STEP = """
SELECT * FROM plan_state WHERE session_id = ? AND step_index = ?
"""
