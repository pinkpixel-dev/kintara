-- GitHub identities and invitation-only access.

ALTER TABLE users ADD COLUMN github_user_id INTEGER;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users DROP COLUMN password_hash;

CREATE TABLE github_invitations (
    github_login TEXT    PRIMARY KEY COLLATE NOCASE,
    is_admin     INTEGER NOT NULL DEFAULT 0,
    invited_by   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE oauth_states (
    state         TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    expires_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_users_github_id ON users (github_user_id);
CREATE INDEX idx_oauth_states_expiry ON oauth_states (expires_at);
