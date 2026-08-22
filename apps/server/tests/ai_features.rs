//! Search, find, and cover routes.
//!
//! Split from `ai.rs`, which covers keys and settings, when one file outgrew
//! the size limit. Everything here proves a request is refused before it can
//! reach a provider — no test in this file makes a network call.

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::{
    TestApp, ai_settings as settings, body_json, invited_user, json_with_cookie, signed_in_owner,
};
use serde_json::json;

#[tokio::test]
async fn library_search_refuses_before_any_provider_call() {
    let app = TestApp::new().await;
    let (_user_id, cookie) = signed_in_owner(&app).await;

    // AI off entirely: nothing should reach a provider, and no key is set.
    let disabled = json_with_cookie(
        &app,
        "POST",
        "/api/ai/search",
        &cookie,
        json!({ "request": "crochet dragons" }),
    )
    .await;
    assert_eq!(disabled.status(), StatusCode::BAD_REQUEST);

    json_with_cookie(
        &app,
        "PUT",
        "/api/ai/settings",
        &cookie,
        settings(Some("sk-test-key"), true),
    )
    .await;

    // An empty request never becomes a billed round trip.
    let empty = json_with_cookie(
        &app,
        "POST",
        "/api/ai/search",
        &cookie,
        json!({ "request": "   " }),
    )
    .await;
    assert_eq!(empty.status(), StatusCode::BAD_REQUEST);
    assert!(
        body_json(empty).await["error"]
            .as_str()
            .unwrap()
            .contains("describe what you are looking for")
    );

    let too_long = json_with_cookie(
        &app,
        "POST",
        "/api/ai/search",
        &cookie,
        json!({ "request": "d".repeat(501) }),
    )
    .await;
    assert_eq!(too_long.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn library_search_requires_a_session() {
    let app = TestApp::new().await;
    let response = app
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/ai/search")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "request": "anything" }).to_string()))
                .unwrap(),
        )
        .await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn in_document_find_refuses_before_any_provider_call() {
    let app = TestApp::new().await;
    let (_user_id, cookie) = signed_in_owner(&app).await;
    let document_id = app.insert_row("Notes", "notes.md", "md", 10).await;

    // AI is off, so nothing can reach a provider whatever the request says.
    let disabled = json_with_cookie(
        &app,
        "POST",
        &format!("/api/ai/documents/{document_id}/find"),
        &cookie,
        json!({ "request": "where is the magic ring" }),
    )
    .await;
    assert_eq!(disabled.status(), StatusCode::BAD_REQUEST);

    json_with_cookie(
        &app,
        "PUT",
        "/api/ai/settings",
        &cookie,
        settings(Some("sk-test-key"), true),
    )
    .await;

    let empty = json_with_cookie(
        &app,
        "POST",
        &format!("/api/ai/documents/{document_id}/find"),
        &cookie,
        json!({ "request": "  " }),
    )
    .await;
    assert_eq!(empty.status(), StatusCode::BAD_REQUEST);
    assert!(
        body_json(empty).await["error"]
            .as_str()
            .unwrap()
            .contains("describe what to look for")
    );

    // This row has no extracted text at all, which must be refused rather than
    // sent as an empty document.
    let no_text = json_with_cookie(
        &app,
        "POST",
        &format!("/api/ai/documents/{document_id}/find"),
        &cookie,
        json!({ "request": "where is the magic ring" }),
    )
    .await;
    assert_eq!(no_text.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn in_document_find_is_refused_on_a_document_the_caller_cannot_see() {
    let app = TestApp::new().await;
    let (owner_id, _cookie) = signed_in_owner(&app).await;
    let outsider_id = invited_user(&app, owner_id, "outsider", 404).await;
    let document_id = app.insert_row("Private", "private.md", "md", 10).await;

    let response = app
        .send_json_as(
            "POST",
            &format!("/api/ai/documents/{document_id}/find"),
            json!({ "request": "anything" }),
            outsider_id,
        )
        .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn image_model_choices_are_saved_and_returned_per_user() {
    let app = TestApp::new().await;
    let (_user_id, cookie) = signed_in_owner(&app).await;
    let mut body = settings(Some("sk-test-key"), true);
    body["googleImageModel"] = json!("gemini-3-pro-image");
    let saved =
        body_json(json_with_cookie(&app, "PUT", "/api/ai/settings", &cookie, body).await).await;
    assert_eq!(saved["openaiImageModel"], "gpt-image-2");
    assert_eq!(saved["googleImageModel"], "gemini-3-pro-image");
}

#[tokio::test]
async fn metadata_suggestions_require_a_session() {
    let app = TestApp::new().await;
    let response = app
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/ai/documents/1/metadata")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn metadata_suggestions_allow_editors_but_not_viewers() {
    let app = TestApp::new().await;
    let (owner_id, _cookie) = signed_in_owner(&app).await;
    let viewer_id = invited_user(&app, owner_id, "metadata-viewer", 606).await;
    let editor_id = invited_user(&app, owner_id, "metadata-editor", 707).await;
    let editor_cookie = app.session_cookie_for(editor_id).await;
    let disabled_settings = json_with_cookie(
        &app,
        "PUT",
        "/api/ai/settings",
        &editor_cookie,
        settings(None, false),
    )
    .await;
    assert_eq!(disabled_settings.status(), StatusCode::OK);
    let document_id = app
        .insert_row("Filename fallback", "shared-metadata.md", "md", 10)
        .await;
    let library_id: i64 = sqlx::query_scalar(
        "INSERT INTO libraries (owner_id, name) VALUES (?, 'Metadata library') RETURNING id",
    )
    .bind(owner_id)
    .fetch_one(&app.db)
    .await
    .unwrap();
    sqlx::query("INSERT INTO library_documents (library_id, document_id) VALUES (?, ?)")
        .bind(library_id)
        .bind(document_id)
        .execute(&app.db)
        .await
        .unwrap();
    for (user_id, role) in [(viewer_id, "viewer"), (editor_id, "editor")] {
        sqlx::query("INSERT INTO library_members (library_id, user_id, role) VALUES (?, ?, ?)")
            .bind(library_id)
            .bind(user_id)
            .bind(role)
            .execute(&app.db)
            .await
            .unwrap();
    }
    sqlx::query("UPDATE documents SET text_status = 'ok' WHERE id = ?")
        .bind(document_id)
        .execute(&app.db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO document_pages (document_id, page_number, text) VALUES (?, 1, ?)")
        .bind(document_id)
        .bind("A Real Title\nBy A Real Author\nPublished 2024")
        .execute(&app.db)
        .await
        .unwrap();

    let viewer = app
        .send_json_as(
            "POST",
            &format!("/api/ai/documents/{document_id}/metadata"),
            json!({ "expectedProvider": "openai", "expectedModel": "gpt-5.6-terra" }),
            viewer_id,
        )
        .await;
    assert_eq!(viewer.status(), StatusCode::NOT_FOUND);

    // The editor passes the metadata permission check and reaches the next
    // safe refusal. AI is disabled, so no provider request can occur.
    let editor = app
        .send_json_as(
            "POST",
            &format!("/api/ai/documents/{document_id}/metadata"),
            json!({ "expectedProvider": "openai", "expectedModel": "gpt-5.6-terra" }),
            editor_id,
        )
        .await;
    assert_eq!(editor.status(), StatusCode::BAD_REQUEST);
    assert!(body_json(editor).await["error"]
        .as_str()
        .unwrap()
        .contains("AI features are disabled"));

    let usage: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_usage")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(usage, 0);
    let title: String = sqlx::query_scalar("SELECT title FROM documents WHERE id = ?")
        .bind(document_id)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(title, "Filename fallback");
}

#[tokio::test]
async fn metadata_suggestions_refuse_unreadable_text_without_writing() {
    let app = TestApp::new().await;
    let (_owner_id, cookie) = signed_in_owner(&app).await;
    let document_id = app
        .insert_row("Image only", "image-only.pdf", "pdf", 10)
        .await;
    sqlx::query("UPDATE documents SET text_status = 'empty', author = 'Human edit' WHERE id = ?")
        .bind(document_id)
        .execute(&app.db)
        .await
        .unwrap();

    let response = json_with_cookie(
        &app,
        "POST",
        &format!("/api/ai/documents/{document_id}/metadata"),
        &cookie,
        json!({ "expectedProvider": "openai", "expectedModel": "gpt-5.6-terra" }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(body_json(response).await["error"]
        .as_str()
        .unwrap()
        .contains("OCR is not available"));

    let (author, usage): (Option<String>, i64) = sqlx::query_as(
        "SELECT author, (SELECT COUNT(*) FROM ai_usage) FROM documents WHERE id = ?",
    )
    .bind(document_id)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(author.as_deref(), Some("Human edit"));
    assert_eq!(usage, 0);
}

#[tokio::test]
async fn metadata_suggestions_reject_stale_provider_confirmation() {
    let app = TestApp::new().await;
    let (_owner_id, cookie) = signed_in_owner(&app).await;
    let configured = json_with_cookie(
        &app,
        "PUT",
        "/api/ai/settings",
        &cookie,
        settings(Some("sk-not-a-real-provider-key"), true),
    )
    .await;
    assert_eq!(configured.status(), StatusCode::OK);

    let document_id = app.insert_row("Confirmed", "confirmed.md", "md", 10).await;
    sqlx::query("UPDATE documents SET text_status = 'ok' WHERE id = ?")
        .bind(document_id)
        .execute(&app.db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO document_pages (document_id, page_number, text) VALUES (?, 1, ?)")
        .bind(document_id)
        .bind("A titled document with readable text.")
        .execute(&app.db)
        .await
        .unwrap();

    let response = json_with_cookie(
        &app,
        "POST",
        &format!("/api/ai/documents/{document_id}/metadata"),
        &cookie,
        json!({ "expectedProvider": "google", "expectedModel": "gemini-3.7-flash" }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(body_json(response).await["error"]
        .as_str()
        .unwrap()
        .contains("review the provider request again"));
    let usage: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_usage")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(usage, 0);
}
