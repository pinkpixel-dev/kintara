-- Session storage.
--
-- Sessions live in the database rather than in a signed cookie so that logging
-- out actually revokes access, and so a stolen cookie can be invalidated. The
-- cookie carries only an opaque random id.

CREATE TABLE sessions (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);
