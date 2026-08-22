-- Per-user provider configuration and token usage.

CREATE TABLE user_ai_settings (
    user_id            INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    enabled            INTEGER NOT NULL DEFAULT 0,
    provider           TEXT CHECK (provider IN ('openai', 'google')),
    openai_api_key     TEXT,
    google_api_key     TEXT,
    openai_key_hint    TEXT,
    google_key_hint    TEXT,
    openai_model       TEXT,
    google_model       TEXT,
    openai_reasoning   TEXT,
    google_thinking    TEXT,
    temperature        REAL CHECK (temperature BETWEEN 0 AND 2),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ai_usage (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    document_id   INTEGER REFERENCES documents (id) ON DELETE SET NULL,
    feature       TEXT    NOT NULL,
    provider      TEXT    NOT NULL,
    model         TEXT    NOT NULL,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ai_usage_user_created ON ai_usage (user_id, created_at DESC);
