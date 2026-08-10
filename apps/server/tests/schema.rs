//! Schema behaviour tests.
//!
//! These run against a real SQLite file created by the real migrations — no
//! mocks — because the things worth testing here (cascade deletes, FTS trigger
//! sync, CHECK constraints) are behaviours of SQLite itself, and a fake would
//! prove nothing.

use kintara_server::db;
use sqlx::SqlitePool;

async fn fresh_db() -> (tempfile::TempDir, SqlitePool) {
    let dir = tempfile::tempdir().expect("tempdir");
    let pool = db::connect(&dir.path().join("kintara.db"))
        .await
        .expect("migrations should apply to an empty database");
    (dir, pool)
}

/// Inserts one user and one document, returning their ids. Ids are read back
/// rather than assumed, because AUTOINCREMENT does not restart at 1.
async fn seed(pool: &SqlitePool) -> (i64, i64) {
    let user_id: i64 =
        sqlx::query_scalar("INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id")
            .bind("jess")
            .bind("hash")
            .fetch_one(pool)
            .await
            .expect("insert user");

    let doc_id: i64 = sqlx::query_scalar(
        "INSERT INTO documents (title, relative_path, document_type)
         VALUES (?, ?, ?) RETURNING id",
    )
    .bind("Attention Is All You Need")
    .bind("papers/attention.pdf")
    .bind("pdf")
    .fetch_one(pool)
    .await
    .expect("insert document");

    (user_id, doc_id)
}

#[tokio::test]
async fn migrations_apply_to_an_empty_database() {
    let (_dir, pool) = fresh_db().await;

    let tables: Vec<String> =
        sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .fetch_all(&pool)
            .await
            .expect("list tables");

    for expected in [
        "annotations",
        "collections",
        "documents",
        "libraries",
        "user_document_state",
        "users",
    ] {
        assert!(
            tables.iter().any(|t| t == expected),
            "expected table {expected} to exist, got {tables:?}"
        );
    }
}

#[tokio::test]
async fn wal_and_foreign_keys_are_enabled_on_pool_connections() {
    let (_dir, pool) = fresh_db().await;

    let journal: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(&pool)
        .await
        .expect("journal_mode");
    assert_eq!(journal.to_lowercase(), "wal");

    // Enforcement is per-connection in SQLite, so this has to be checked on a
    // pool connection rather than trusted from the migration file.
    let fk: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&pool)
        .await
        .expect("foreign_keys");
    assert_eq!(fk, 1, "foreign key enforcement must be on");
}

#[tokio::test]
async fn deleting_a_document_cascades_to_per_user_state_and_annotations() {
    let (_dir, pool) = fresh_db().await;
    let (user_id, doc_id) = seed(&pool).await;

    sqlx::query(
        "INSERT INTO user_document_state (user_id, document_id, reading_progress, is_favorite)
         VALUES (?, ?, 0.42, 1)",
    )
    .bind(user_id)
    .bind(doc_id)
    .execute(&pool)
    .await
    .expect("insert reading state");

    sqlx::query(
        "INSERT INTO annotations (document_id, user_id, annotation_type, serialized_position)
         VALUES (?, ?, 'highlight', '{}')",
    )
    .bind(doc_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("insert annotation");

    sqlx::query("DELETE FROM documents WHERE id = ?")
        .bind(doc_id)
        .execute(&pool)
        .await
        .expect("delete document");

    let state: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user_document_state")
        .fetch_one(&pool)
        .await
        .unwrap();
    let annotations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM annotations")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(state, 0, "reading state should not outlive its document");
    assert_eq!(annotations, 0, "annotations should not outlive their document");
}

#[tokio::test]
async fn deleting_a_library_cascades_to_its_collections() {
    let (_dir, pool) = fresh_db().await;

    let library_id: i64 =
        sqlx::query_scalar("INSERT INTO libraries (name) VALUES ('Papers') RETURNING id")
            .fetch_one(&pool)
            .await
            .expect("insert library");

    sqlx::query("INSERT INTO collections (library_id, name) VALUES (?, '2026')")
        .bind(library_id)
        .execute(&pool)
        .await
        .expect("insert collection");

    sqlx::query("DELETE FROM libraries WHERE id = ?")
        .bind(library_id)
        .execute(&pool)
        .await
        .expect("delete library");

    let collections: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM collections")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(collections, 0);
}

#[tokio::test]
async fn annotation_type_is_constrained() {
    let (_dir, pool) = fresh_db().await;
    let (user_id, doc_id) = seed(&pool).await;

    let result = sqlx::query(
        "INSERT INTO annotations (document_id, user_id, annotation_type, serialized_position)
         VALUES (?, ?, 'scribble', '{}')",
    )
    .bind(doc_id)
    .bind(user_id)
    .execute(&pool)
    .await;

    assert!(
        result.is_err(),
        "annotation_type outside ('highlight','note') must be rejected"
    );
}

#[tokio::test]
async fn fts_index_tracks_inserts_updates_and_deletes() {
    let (_dir, pool) = fresh_db().await;
    let (_user_id, doc_id) = seed(&pool).await;

    async fn matches(pool: &SqlitePool, term: &str) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM documents_fts WHERE documents_fts MATCH ?")
            .bind(term)
            .fetch_one(pool)
            .await
            .expect("fts query")
    }

    assert_eq!(matches(&pool, "attention").await, 1, "insert should index");

    sqlx::query("UPDATE documents SET title = 'Sparse Attention 2017' WHERE id = ?")
        .bind(doc_id)
        .execute(&pool)
        .await
        .expect("update document");

    assert_eq!(matches(&pool, "2017").await, 1, "update should reindex");
    assert_eq!(
        matches(&pool, "\"Is All You Need\"").await,
        0,
        "the old title should no longer match after an update"
    );

    sqlx::query("DELETE FROM documents WHERE id = ?")
        .bind(doc_id)
        .execute(&pool)
        .await
        .expect("delete document");

    assert_eq!(matches(&pool, "attention").await, 0, "delete should deindex");

    let fts_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM documents_fts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(fts_rows, 0, "fts index must not drift from documents");
}

#[tokio::test]
async fn relative_path_is_unique() {
    let (_dir, pool) = fresh_db().await;
    seed(&pool).await;

    let duplicate = sqlx::query(
        "INSERT INTO documents (title, relative_path, document_type)
         VALUES ('Another', 'papers/attention.pdf', 'pdf')",
    )
    .execute(&pool)
    .await;

    assert!(
        duplicate.is_err(),
        "the same relative path must not be indexed twice"
    );
}
