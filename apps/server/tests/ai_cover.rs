//! Cover generation validation, permissions, and preflight behavior.
//! No test in this file makes a provider request.

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::{
    TestApp, ai_settings as settings, body_json, invited_user, json_with_cookie, signed_in_owner,
};
use serde_json::json;

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

    let configured = json_with_cookie(
        &app,
        "PUT",
        "/api/ai/settings",
        &cookie,
        settings(Some("sk-test-key"), true),
    )
    .await;
    assert_eq!(configured.status(), StatusCode::OK);

    for custom_prompt in ["   ".to_string(), "x".repeat(1_001)] {
        let invalid = json_with_cookie(
            &app,
            "POST",
            &format!("/api/ai/documents/{document_id}/cover"),
            &cookie,
            json!({ "customPrompt": custom_prompt }),
        )
        .await;
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    }
    let usage: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_usage")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(usage, 0);

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

    let response = app
        .send_json_as(
            "POST",
            &format!("/api/ai/documents/{document_id}/cover"),
            json!({ "customPrompt": "A bright geometric replacement cover" }),
            viewer_id,
        )
        .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn cover_generation_requires_a_session() {
    let app = TestApp::new().await;
    let response = app
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/ai/documents/1/cover")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "customPrompt": "anything" }).to_string(),
                ))
                .unwrap(),
        )
        .await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn cover_preflight_does_not_require_readable_document_text() {
    let app = TestApp::new().await;
    let (_user_id, cookie) = signed_in_owner(&app).await;
    let configured = json_with_cookie(
        &app,
        "PUT",
        "/api/ai/settings",
        &cookie,
        settings(Some("sk-test-key"), true),
    )
    .await;
    assert_eq!(configured.status(), StatusCode::OK);

    let document_id = app.insert_row("Scanned", "scanned.pdf", "pdf", 10).await;
    sqlx::query(
        "UPDATE documents SET text_status = 'empty', thumbnail_name = 'first-page.jpg' WHERE id = ?",
    )
    .bind(document_id)
    .execute(&app.db)
    .await
    .unwrap();

    let response = json_with_cookie(
        &app,
        "GET",
        &format!("/api/ai/documents/{document_id}/preflight"),
        &cookie,
        json!({}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["canGenerateCover"], true);
    assert_eq!(body["canSummarize"], false);
    assert_eq!(body["canSuggestMetadata"], false);
    assert_eq!(body["hasCover"], true);
}
