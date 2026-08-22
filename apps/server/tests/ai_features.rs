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
async fn cover_generation_is_refused_before_any_provider_call() {
    let app = TestApp::new().await;
    let (_user_id, cookie) = signed_in_owner(&app).await;
    let document_id = app.insert_row("Cover me", "cover.md", "md", 10).await;

    let disabled = json_with_cookie(
        &app,
        "POST",
        &format!("/api/ai/documents/{document_id}/cover"),
        &cookie,
        json!({}),
    )
    .await;
    assert_eq!(disabled.status(), StatusCode::BAD_REQUEST);

    // An unsupported image model is rejected when it is saved, not when it is
    // first used against a billed endpoint.
    let mut bad = settings(Some("sk-test-key"), true);
    bad["openaiImageModel"] = json!("gpt-5.6-terra");
    let response = json_with_cookie(&app, "PUT", "/api/ai/settings", &cookie, bad).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(
        body_json(response).await["error"]
            .as_str()
            .unwrap()
            .contains("supported image model")
    );
}

#[tokio::test]
async fn a_viewer_cannot_generate_a_cover_for_someone_elses_document() {
    let app = TestApp::new().await;
    let (owner_id, _cookie) = signed_in_owner(&app).await;
    let viewer_id = invited_user(&app, owner_id, "viewer", 505).await;
    let document_id = app.insert_row("Shared", "shared-cover.md", "md", 10).await;
    let library_id: i64 = sqlx::query_scalar(
        "INSERT INTO libraries (owner_id, name) VALUES (?, 'Shared') RETURNING id",
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
    sqlx::query("INSERT INTO library_members (library_id, user_id, role) VALUES (?, ?, 'viewer')")
        .bind(library_id)
        .bind(viewer_id)
        .execute(&app.db)
        .await
        .unwrap();

    // A cover is shared metadata, so read access is not enough to replace it.
    let response = app
        .send_json_as(
            "POST",
            &format!("/api/ai/documents/{document_id}/cover"),
            json!({}),
            viewer_id,
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
