mod common;

use axum::http::StatusCode;
use common::{body_json, TestApp};
use serde_json::json;

// ---------------------------------------------------- metadata edits
#[tokio::test]
async fn metadata_can_be_edited_and_individual_fields_cleared() {
    let app = TestApp::new().await;
    let id = app.add_document("paper.pdf", b"bytes").await;

    let response = app
        .send_json(
            "PATCH",
            &format!("/api/documents/{id}"),
            json!({ "title": "Real Title", "author": "Ada", "year": 1843 }),
        )
        .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let doc = body_json(app.get(&format!("/api/documents/{id}")).await).await;
    assert_eq!(doc["title"], "Real Title");
    assert_eq!(doc["author"], "Ada");
    assert_eq!(doc["year"], 1843);

    // An explicit null clears the field; an omitted field is left alone. A
    // plain Option would make these two indistinguishable.
    let response = app
        .send_json(
            "PATCH",
            &format!("/api/documents/{id}"),
            json!({ "author": null }),
        )
        .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let doc = body_json(app.get(&format!("/api/documents/{id}")).await).await;
    assert!(doc["author"].is_null(), "author should have been cleared");
    assert_eq!(doc["title"], "Real Title", "title should be untouched");
    assert_eq!(doc["year"], 1843, "year should be untouched");
}

#[tokio::test]
async fn an_empty_title_is_rejected() {
    let app = TestApp::new().await;
    let id = app.add_document("paper.pdf", b"bytes").await;

    let response = app
        .send_json(
            "PATCH",
            &format!("/api/documents/{id}"),
            json!({ "title": "   " }),
        )
        .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn editing_a_document_keeps_the_search_index_in_step() {
    let app = TestApp::new().await;
    let id = app.add_document("paper.pdf", b"bytes").await;

    app.send_json(
        "PATCH",
        &format!("/api/documents/{id}"),
        json!({ "title": "Quantum Entanglement" }),
    )
    .await;

    let found = body_json(app.get("/api/documents?q=entanglement").await).await;
    assert_eq!(found["total"], 1, "FTS triggers should pick up the new title");

    let stale = body_json(app.get("/api/documents?q=paper").await).await;
    assert_eq!(stale["total"], 0, "the old title should no longer match");
}

// --------------------------------------------------------- per-user state

#[tokio::test]
async fn reading_progress_is_stored_and_returned() {
    let app = TestApp::new().await;
    let id = app.add_document("paper.pdf", b"bytes").await;

    let response = app
        .send_json(
            "PUT",
            &format!("/api/documents/{id}/progress"),
            json!({ "readingProgress": 0.42 }),
        )
        .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let doc = body_json(app.get(&format!("/api/documents/{id}")).await).await;
    assert_eq!(doc["readingProgress"], 0.42);

    // Upsert: a second write updates rather than failing on the primary key.
    app.send_json(
        "PUT",
        &format!("/api/documents/{id}/progress"),
        json!({ "readingProgress": 0.9 }),
    )
    .await;
    let doc = body_json(app.get(&format!("/api/documents/{id}")).await).await;
    assert_eq!(doc["readingProgress"], 0.9);
}

#[tokio::test]
async fn out_of_range_progress_is_rejected() {
    let app = TestApp::new().await;
    let id = app.add_document("paper.pdf", b"bytes").await;

    for value in [-0.1, 1.5] {
        let response = app
            .send_json(
                "PUT",
                &format!("/api/documents/{id}/progress"),
                json!({ "readingProgress": value }),
            )
            .await;
        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "progress {value} should be rejected"
        );
    }
}

#[tokio::test]
async fn favouriting_a_document_shows_up_in_the_favourites_filter() {
    let app = TestApp::new().await;
    let id = app.add_document("paper.pdf", b"bytes").await;

    app.send_json(
        "PUT",
        &format!("/api/documents/{id}/favorite"),
        json!({ "isFavorite": true }),
    )
    .await;

    let listed = body_json(app.get("/api/documents?favorite=true").await).await;
    assert_eq!(listed["total"], 1);

    app.send_json(
        "PUT",
        &format!("/api/documents/{id}/favorite"),
        json!({ "isFavorite": false }),
    )
    .await;

    let listed = body_json(app.get("/api/documents?favorite=true").await).await;
    assert_eq!(listed["total"], 0);
}

#[tokio::test]
async fn per_user_writes_against_a_missing_document_are_404() {
    let app = TestApp::new().await;

    let response = app
        .send_json(
            "PUT",
            "/api/documents/9999/progress",
            json!({ "readingProgress": 0.5 }),
        )
        .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

// ---------------------------------------------------- delete
#[tokio::test]
async fn deleting_a_document_removes_the_row_the_file_and_the_thumbnail() {
    let app = TestApp::new().await;
    let id = app.add_document("paper.pdf", b"bytes").await;

    let thumbnail = app.config.thumbnail_dir().join("t.jpg");
    std::fs::write(&thumbnail, b"jpeg").unwrap();
    sqlx::query("UPDATE documents SET thumbnail_name = 't.jpg' WHERE id = ?")
        .bind(id)
        .execute(&app.db)
        .await
        .unwrap();

    let response = app.delete(&format!("/api/documents/{id}")).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // The file goes too: the scanner would otherwise re-index it and delete
    // would appear not to work.
    assert!(!app.config.library_dir.join("paper.pdf").exists());
    assert!(!thumbnail.exists());
    assert_eq!(
        app.get(&format!("/api/documents/{id}")).await.status(),
        StatusCode::NOT_FOUND
    );
}
