-- Private, per-user document conversations and page citations.

CREATE TABLE ai_conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, document_id)
);

CREATE TABLE ai_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES ai_conversations (id) ON DELETE CASCADE,
    role            TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
    kind            TEXT    NOT NULL CHECK (kind IN ('question', 'summary')),
    content         TEXT    NOT NULL CHECK (length(trim(content)) > 0),
    provider        TEXT    CHECK (provider IN ('openai', 'google')),
    model           TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ai_message_citations (
    message_id  INTEGER NOT NULL REFERENCES ai_messages (id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    excerpt     TEXT,
    PRIMARY KEY (message_id, page_number)
);

CREATE INDEX idx_ai_conversations_user_document
    ON ai_conversations (user_id, document_id);
CREATE INDEX idx_ai_messages_conversation_created
    ON ai_messages (conversation_id, id);
