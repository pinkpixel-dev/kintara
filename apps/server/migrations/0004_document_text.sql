-- Searchable, page-addressable document text.

ALTER TABLE documents ADD COLUMN text_extracted_at TEXT;
ALTER TABLE documents ADD COLUMN text_status TEXT
    CHECK (text_status IN ('ok', 'empty', 'truncated', 'failed'));

CREATE TABLE document_pages (
    document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    text        TEXT    NOT NULL,
    PRIMARY KEY (document_id, page_number)
);

CREATE INDEX idx_document_pages_document ON document_pages (document_id, page_number);
