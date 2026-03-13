"""DDL — full schema, applied once on DB open."""

PRAGMA = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
"""

CREATE_SESSIONS = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id       TEXT PRIMARY KEY,
    started_at       REAL NOT NULL,
    phase            TEXT NOT NULL DEFAULT 'discovery',
    status           TEXT NOT NULL DEFAULT 'active',
    aborted_at       REAL,
    recipe_plan_json TEXT
);
"""

CREATE_MESSAGES = """
CREATE TABLE IF NOT EXISTS messages (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     TEXT NOT NULL,
    timestamp      REAL NOT NULL,
    epoch          INTEGER NOT NULL DEFAULT 0,
    type           TEXT NOT NULL,
    role           TEXT NOT NULL,
    content        TEXT,
    frame_data     BLOB,
    frame_path     TEXT,
    metadata_json  TEXT,
    processed      INTEGER NOT NULL DEFAULT 0
);
"""

CREATE_MESSAGES_INDEX = """
CREATE INDEX IF NOT EXISTS idx_messages_queue
    ON messages (session_id, processed, timestamp);
"""

CREATE_PLAN_STATE = """
CREATE TABLE IF NOT EXISTS plan_state (
    session_id            TEXT NOT NULL,
    step_index            INTEGER NOT NULL,
    instruction           TEXT NOT NULL,
    expected_visual_state TEXT NOT NULL DEFAULT '',
    expected_texture      TEXT NOT NULL DEFAULT '',
    expected_taste_smell  TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL DEFAULT 'pending',
    amended_at            REAL,
    PRIMARY KEY (session_id, step_index)
);
"""

# Applied as a single executescript call on writer open
SCHEMA = PRAGMA + CREATE_SESSIONS + CREATE_MESSAGES + CREATE_MESSAGES_INDEX + CREATE_PLAN_STATE
