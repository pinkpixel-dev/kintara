-- Personal libraries and explicit sharing.
--
-- The seeded installation owner receives all existing libraries and documents.
-- New documents receive an owner in application code; triggers keep a missing
-- owner from turning into a globally visible row if a future write path forgets.

ALTER TABLE documents ADD COLUMN owner_id INTEGER REFERENCES users (id) ON DELETE RESTRICT;

UPDATE documents
SET owner_id = (
    SELECT id FROM users ORDER BY is_admin DESC, id ASC LIMIT 1
);

CREATE INDEX idx_documents_owner ON documents (owner_id);

CREATE TRIGGER documents_owner_required_insert
BEFORE INSERT ON documents
WHEN NEW.owner_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'document owner is required');
END;

CREATE TRIGGER documents_owner_required_update
BEFORE UPDATE OF owner_id ON documents
WHEN NEW.owner_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'document owner is required');
END;

-- Rebuild the taxonomy tables so library names are unique per owner instead
-- of across the whole Kintara installation. The replacement tables preserve
-- every existing id and membership row.
CREATE TABLE libraries_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    name        TEXT    NOT NULL,
    theme_color TEXT,
    icon        TEXT,
    icon_color  TEXT,
    UNIQUE (owner_id, name)
);

INSERT INTO libraries_new (id, owner_id, name, theme_color, icon, icon_color)
SELECT id,
       (SELECT id FROM users ORDER BY is_admin DESC, id ASC LIMIT 1),
       name, theme_color, icon, icon_color
FROM libraries;

CREATE TABLE collections_new (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL REFERENCES libraries_new (id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    UNIQUE (library_id, name)
);

INSERT INTO collections_new (id, library_id, name)
SELECT id, library_id, name FROM collections;

CREATE TABLE library_documents_new (
    library_id  INTEGER NOT NULL REFERENCES libraries_new (id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents (id)     ON DELETE CASCADE,
    PRIMARY KEY (library_id, document_id)
);

INSERT INTO library_documents_new (library_id, document_id)
SELECT library_id, document_id FROM library_documents;

CREATE TABLE document_collections_new (
    collection_id INTEGER NOT NULL REFERENCES collections_new (id) ON DELETE CASCADE,
    document_id   INTEGER NOT NULL REFERENCES documents (id)       ON DELETE CASCADE,
    PRIMARY KEY (collection_id, document_id)
);

INSERT INTO document_collections_new (collection_id, document_id)
SELECT collection_id, document_id FROM document_collections;

DROP TABLE document_collections;
DROP TABLE library_documents;
DROP TABLE collections;
DROP TABLE libraries;

ALTER TABLE libraries_new RENAME TO libraries;
ALTER TABLE collections_new RENAME TO collections;
ALTER TABLE library_documents_new RENAME TO library_documents;
ALTER TABLE document_collections_new RENAME TO document_collections;

CREATE INDEX idx_libraries_owner ON libraries (owner_id);

CREATE TABLE library_members (
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users (id)     ON DELETE CASCADE,
    role       TEXT    NOT NULL CHECK (role IN ('viewer', 'editor')),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (library_id, user_id)
);

CREATE INDEX idx_library_members_user ON library_members (user_id, library_id);

-- Unattached tags are part of a user's private filing vocabulary. Tags on a
-- shared document remain visible through that document, but two users can both
-- create a tag called "patterns" without colliding.
CREATE TABLE tags_new (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name     TEXT    NOT NULL,
    color    TEXT,
    UNIQUE (owner_id, name)
);

INSERT INTO tags_new (id, owner_id, name, color)
SELECT id,
       (SELECT id FROM users ORDER BY is_admin DESC, id ASC LIMIT 1),
       name, color
FROM tags;

CREATE TABLE document_tags_new (
    document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags_new (id)  ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
);

INSERT INTO document_tags_new (document_id, tag_id)
SELECT document_id, tag_id FROM document_tags;

DROP TABLE document_tags;
DROP TABLE tags;

ALTER TABLE tags_new RENAME TO tags;
ALTER TABLE document_tags_new RENAME TO document_tags;

CREATE INDEX idx_tags_owner ON tags (owner_id);
