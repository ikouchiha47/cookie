"""SQL constants for the messages table (queue backing store)."""

INSERT = """
INSERT INTO messages
    (session_id, timestamp, epoch, type, role, content, frame_data, frame_path, metadata_json, processed)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

FETCH_UNPROCESSED = """
SELECT * FROM messages
WHERE session_id = ? AND processed = 0
ORDER BY timestamp ASC
"""

FETCH_RECENT_PROCESSED = """
SELECT * FROM messages
WHERE session_id = ? AND processed = 1
ORDER BY timestamp DESC
LIMIT ?
"""

# Placeholder count is injected at call time via str.format or f-string
MARK_PROCESSED_TEMPLATE = """
UPDATE messages SET processed = 1 WHERE id IN ({placeholders})
"""
