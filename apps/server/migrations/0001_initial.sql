-- Kintara server schema, v1.
--
-- Ported from the desktop migrations in apps/desktop/src/lib.rs with four
-- deliberate changes for multi-user, containerised operation:
--
--   1. documents.relative_path replaces the desktop's absolute file_path, so the
--      library volume can be remounted anywhere without invalidating every row.
--   2. reading_progress and is_favorite move off documents into
--      user_document_state, keyed by (user_id, document_id).
--   3. documents gains file_hash / file_size / indexed_at so the scanner can
--      detect new, changed, and duplicate files without re-reading everything.
--   4. Search is backed by an FTS5 virtual table instead of LIKE '%term%'.

CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE documents (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    author         TEXT,
    -- Relative to the configured library root. Never store absolute paths.
    relative_path  TEXT    NOT NULL UNIQUE,
    document_type  TEXT    NOT NULL,
    -- Content hash, used to detect edits and to spot the same file re-added
    -- under a different name. NULL until the scanner has hashed the file.
    file_hash      TEXT,
    file_size      INTEGER,
    -- Filename within the thumbnails directory, not a path.
    thumbnail_name TEXT,
    extracted_text TEXT,
    summary        TEXT,
    keywords       TEXT,
    doi            TEXT,
    isbn           TEXT,
    page_count     INTEGER,
    year           INTEGER,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    modified_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    -- NULL means the row exists but the file has not been processed yet.
    indexed_at     TEXT
);

CREATE INDEX idx_documents_modified_at ON documents (modified_at DESC);
CREATE INDEX idx_documents_file_hash   ON documents (file_hash);

-- Per-user reading state. A missing row means "never opened, not favourited",
-- so readers can LEFT JOIN and coalesce rather than backfilling on user create.
CREATE TABLE user_document_state (
    user_id          INTEGER NOT NULL REFERENCES users (id)     ON DELETE CASCADE,
    document_id      INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    reading_progress REAL    NOT NULL DEFAULT 0,
    is_favorite      INTEGER NOT NULL DEFAULT 0,
    last_opened_at   TEXT,
    PRIMARY KEY (user_id, document_id)
);

CREATE INDEX idx_uds_user_favorite ON user_document_state (user_id, is_favorite);

CREATE TABLE libraries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    theme_color TEXT,
    icon        TEXT,
    icon_color  TEXT
);

CREATE TABLE collections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    UNIQUE (library_id, name)
);

CREATE TABLE tags (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT    NOT NULL UNIQUE,
    color TEXT
);

CREATE TABLE library_documents (
    library_id  INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    PRIMARY KEY (library_id, document_id)
);

CREATE TABLE document_collections (
    collection_id INTEGER NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
    document_id   INTEGER NOT NULL REFERENCES documents (id)   ON DELETE CASCADE,
    PRIMARY KEY (collection_id, document_id)
);

CREATE TABLE document_tags (
    document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags (id)      ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
);

-- Annotations are per-user. The desktop schema had no user_id because there was
-- only ever one reader.
CREATE TABLE annotations (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id         INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    user_id             INTEGER NOT NULL REFERENCES users (id)     ON DELETE CASCADE,
    annotation_type     TEXT    NOT NULL CHECK (annotation_type IN ('highlight', 'note')),
    serialized_position TEXT    NOT NULL,
    content             TEXT,
    color               TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_annotations_doc_user ON annotations (document_id, user_id);

-- Full-text search. External-content table so the text is not stored twice;
-- documents remains the source of truth and the triggers below keep them in sync.
CREATE VIRTUAL TABLE documents_fts USING fts5 (
    title,
    author,
    keywords,
    summary,
    extracted_text,
    content         = 'documents',
    content_rowid   = 'id',
    tokenize        = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER documents_fts_insert AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts (rowid, title, author, keywords, summary, extracted_text)
    VALUES (new.id, new.title, new.author, new.keywords, new.summary, new.extracted_text);
END;

CREATE TRIGGER documents_fts_delete AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts (documents_fts, rowid, title, author, keywords, summary, extracted_text)
    VALUES ('delete', old.id, old.title, old.author, old.keywords, old.summary, old.extracted_text);
END;

CREATE TRIGGER documents_fts_update AFTER UPDATE ON documents BEGIN
    INSERT INTO documents_fts (documents_fts, rowid, title, author, keywords, summary, extracted_text)
    VALUES ('delete', old.id, old.title, old.author, old.keywords, old.summary, old.extracted_text);
    INSERT INTO documents_fts (rowid, title, author, keywords, summary, extracted_text)
    VALUES (new.id, new.title, new.author, new.keywords, new.summary, new.extracted_text);
END;
