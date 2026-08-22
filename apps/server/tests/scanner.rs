mod common;

use common::{TestApp, sample_pdf};
use kintara_server::scanner;
use kintara_server::state::AppState;

/// The scanner works on the filesystem, so these tests write real files into a
/// real library directory and check what the index looks like afterwards.
fn state_of(app: &TestApp) -> AppState {
    AppState::new(app.db.clone(), app.config.clone())
}

async fn titles(app: &TestApp) -> Vec<String> {
    sqlx::query_scalar("SELECT title FROM documents ORDER BY title")
        .fetch_all(&app.db)
        .await
        .unwrap()
}

#[tokio::test]
async fn a_scan_indexes_files_that_appeared_while_the_server_was_down() {
    let app = TestApp::new().await;
    std::fs::create_dir_all(app.config.library_dir.join("papers")).unwrap();
    std::fs::write(
        app.config.library_dir.join("papers/dropped-in.pdf"),
        sample_pdf(),
    )
    .unwrap();
    std::fs::write(app.config.library_dir.join("notes.md"), b"# hello").unwrap();

    scanner::full_scan(&state_of(&app)).await.unwrap();

    assert_eq!(titles(&app).await, vec!["dropped in", "notes"]);
}

#[tokio::test]
async fn scanning_twice_does_not_duplicate_anything() {
    let app = TestApp::new().await;
    std::fs::write(app.config.library_dir.join("paper.pdf"), sample_pdf()).unwrap();

    let state = state_of(&app);
    scanner::full_scan(&state).await.unwrap();
    scanner::full_scan(&state).await.unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM documents")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn files_deleted_off_the_share_are_dropped_from_the_index() {
    let app = TestApp::new().await;
    let path = app.config.library_dir.join("paper.pdf");
    std::fs::write(&path, sample_pdf()).unwrap();

    let state = state_of(&app);
    scanner::full_scan(&state).await.unwrap();
    assert_eq!(titles(&app).await.len(), 1);

    // Someone deletes it directly over SMB rather than through the app.
    std::fs::remove_file(&path).unwrap();
    scanner::full_scan(&state).await.unwrap();

    assert_eq!(titles(&app).await.len(), 0);
}

#[tokio::test]
async fn a_renamed_file_keeps_its_row_rather_than_becoming_a_new_document() {
    let app = TestApp::new().await;
    std::fs::write(app.config.library_dir.join("old-name.pdf"), sample_pdf()).unwrap();

    let state = state_of(&app);
    scanner::full_scan(&state).await.unwrap();

    let original_id: i64 = sqlx::query_scalar("SELECT id FROM documents")
        .fetch_one(&app.db)
        .await
        .unwrap();

    // Reading progress and highlights hang off the document id, so a rename
    // must not orphan them.
    sqlx::query("INSERT INTO user_document_state (user_id, document_id, reading_progress) VALUES (?, ?, 0.7)")
        .bind(app.user_id().await)
        .bind(original_id)
        .execute(&app.db)
        .await
        .unwrap();

    std::fs::rename(
        app.config.library_dir.join("old-name.pdf"),
        app.config.library_dir.join("new-name.pdf"),
    )
    .unwrap();
    scanner::full_scan(&state).await.unwrap();

    let rows: Vec<(i64, String)> = sqlx::query_as("SELECT id, relative_path FROM documents")
        .fetch_all(&app.db)
        .await
        .unwrap();

    assert_eq!(rows.len(), 1, "a rename must not create a second document");
    assert_eq!(
        rows[0].0, original_id,
        "the document id must survive a rename"
    );
    assert_eq!(rows[0].1, "new-name.pdf");

    let progress: f64 = sqlx::query_scalar(
        "SELECT reading_progress FROM user_document_state WHERE document_id = ?",
    )
    .bind(original_id)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(progress, 0.7, "reading progress must survive a rename");
}

#[tokio::test]
async fn a_duplicate_copy_is_not_indexed_twice() {
    let app = TestApp::new().await;
    std::fs::write(app.config.library_dir.join("paper.pdf"), sample_pdf()).unwrap();
    std::fs::write(app.config.library_dir.join("paper-copy.pdf"), sample_pdf()).unwrap();

    scanner::full_scan(&state_of(&app)).await.unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM documents")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(count, 1, "identical content should produce one entry");
}

#[tokio::test]
async fn edited_files_are_reindexed_without_losing_corrected_metadata() {
    let app = TestApp::new().await;
    let path = app.config.library_dir.join("paper.pdf");
    std::fs::write(&path, sample_pdf()).unwrap();

    let state = state_of(&app);
    scanner::full_scan(&state).await.unwrap();

    let id: i64 = sqlx::query_scalar("SELECT id FROM documents")
        .fetch_one(&app.db)
        .await
        .unwrap();

    // The user fixes a title the extractor got wrong.
    sqlx::query("UPDATE documents SET title = 'Corrected By Hand' WHERE id = ?")
        .bind(id)
        .execute(&app.db)
        .await
        .unwrap();

    let mut changed = sample_pdf();
    changed.extend_from_slice(b"\n% edited\n");
    std::fs::write(&path, &changed).unwrap();

    scanner::full_scan(&state).await.unwrap();

    let (title, size): (String, i64) =
        sqlx::query_as("SELECT title, file_size FROM documents WHERE id = ?")
            .bind(id)
            .fetch_one(&app.db)
            .await
            .unwrap();

    assert_eq!(
        title, "Corrected By Hand",
        "a file edit must not undo a manual correction"
    );
    assert_eq!(
        size,
        changed.len() as i64,
        "the new size should be recorded"
    );
}

#[tokio::test]
async fn non_document_files_on_the_share_are_ignored() {
    let app = TestApp::new().await;
    std::fs::write(app.config.library_dir.join("holiday.jpg"), b"jpegdata").unwrap();
    std::fs::write(app.config.library_dir.join("backup.zip"), b"zipdata").unwrap();
    std::fs::write(app.config.library_dir.join(".DS_Store"), b"junk").unwrap();
    std::fs::write(
        app.config.library_dir.join("half-copied.pdf.part"),
        b"partial",
    )
    .unwrap();

    scanner::full_scan(&state_of(&app)).await.unwrap();

    assert_eq!(titles(&app).await.len(), 0);
}

#[tokio::test]
async fn scanned_documents_are_immediately_searchable_and_readable() {
    let app = TestApp::new().await;
    std::fs::write(
        app.config.library_dir.join("quantum-entanglement.md"),
        b"# physics",
    )
    .unwrap();

    scanner::full_scan(&state_of(&app)).await.unwrap();

    let found = common::body_json(app.get("/api/documents?q=entanglement").await).await;
    assert_eq!(found["total"], 1);

    let id = found["items"][0]["id"].as_i64().unwrap();
    let response = app.get(&format!("/api/documents/{id}/file")).await;
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    assert_eq!(common::body_bytes(response).await, b"# physics");
}

#[tokio::test]
async fn markdown_body_text_is_stored_by_page_and_added_to_fts() {
    let app = TestApp::new().await;
    let path = app.config.library_dir.join("plain-title.md");
    std::fs::write(
        &path,
        b"# Notes\n\nA uniquely searchable chrysanthemum passage.",
    )
    .unwrap();

    scanner::full_scan(&state_of(&app)).await.unwrap();

    let (id, status, body): (i64, String, String) = sqlx::query_as(
        "SELECT id, text_status, extracted_text FROM documents WHERE relative_path = 'plain-title.md'",
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(status, "ok");

    let page: String = sqlx::query_scalar(
        "SELECT text FROM document_pages WHERE document_id = ? AND page_number = 1",
    )
    .bind(id)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(page, body);

    let found = common::body_json(app.get("/api/documents?q=chrysanthemum").await).await;
    assert_eq!(found["total"], 1, "body-only text should be searchable");
}

#[tokio::test]
async fn unchanged_documents_without_extraction_are_backfilled() {
    let app = TestApp::new().await;
    let path = app.config.library_dir.join("backfill.md");
    std::fs::write(&path, b"Backfilled body text").unwrap();
    let state = state_of(&app);
    scanner::full_scan(&state).await.unwrap();

    sqlx::query(
        "UPDATE documents SET extracted_text = NULL, text_status = NULL, text_extracted_at = NULL",
    )
    .execute(&app.db)
    .await
    .unwrap();

    scanner::full_scan(&state).await.unwrap();
    let status: String = sqlx::query_scalar("SELECT text_status FROM documents")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(status, "ok");
}
