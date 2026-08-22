mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::{TestApp, body_json};
use kintara_server::auth::{self, GitHubIdentity};
use kintara_server::state::AppState;
use serde_json::json;

fn state_of(app: &TestApp) -> AppState {
    AppState::new(app.db.clone(), app.config.clone())
}

async fn signed_in_owner(app: &TestApp) -> (i64, String) {
    let state = state_of(app);
    let user_id = auth::resolve_github_user(
        &state,
        &GitHubIdentity {
            id: 101,
            login: "owner".into(),
            avatar_url: None,
        },
    )
    .await
    .unwrap();
    let session = auth::create_session(&state, user_id).await.unwrap();
    (user_id, format!("kintara_session={session}"))
}

async fn json_with_cookie(
    app: &TestApp,
    method: &str,
    uri: &str,
    cookie: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    app.request(
        Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .header("cookie", cookie)
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
}

fn settings(openai_key: Option<&str>, enabled: bool) -> serde_json::Value {
    json!({
        "enabled": enabled,
        "provider": "openai",
        "openaiModel": "gpt-5.6-terra",
        "googleModel": "gemini-3.7-flash",
        "openaiReasoning": "medium",
        "googleThinking": "medium",
        "temperature": null,
        "openaiApiKey": openai_key,
        "googleApiKey": null,
        "removeOpenaiKey": false,
        "removeGoogleKey": false
    })
}

#[tokio::test]
async fn ai_routes_require_a_real_session_even_during_first_run() {
    let app = TestApp::new().await;
    assert_eq!(
        app.get_unauthenticated("/api/ai/settings").await.status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn keys_are_encrypted_at_rest_and_only_a_hint_returns_to_the_browser() {
    let app = TestApp::new().await;
    let (_user_id, cookie) = signed_in_owner(&app).await;
    let response = json_with_cookie(
        &app,
        "PUT",
        "/api/ai/settings",
        &cookie,
        settings(Some("sk-kintara-secret-1234"), true),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let public = body_json(response).await;
    assert_eq!(public["openaiKey"]["set"], true);
    assert_eq!(public["openaiKey"]["hint"], "1234");
    assert!(public.to_string().find("sk-kintara").is_none());

    let stored: String = sqlx::query_scalar("SELECT openai_api_key FROM user_ai_settings")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert!(!stored.contains("sk-kintara"));
    assert!(app.config.data_dir.join("kintara-ai.key").exists());
}

#[tokio::test]
async fn replacing_and_removing_a_key_are_explicit() {
    let app = TestApp::new().await;
    let (_user_id, cookie) = signed_in_owner(&app).await;
    for key in ["sk-first-1111", "sk-second-2222"] {
        let response = json_with_cookie(
            &app,
            "PUT",
            "/api/ai/settings",
            &cookie,
            settings(Some(key), true),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
    }
    let mut remove = settings(None, false);
    remove["removeOpenaiKey"] = json!(true);
    let response = json_with_cookie(&app, "PUT", "/api/ai/settings", &cookie, remove).await;
    let public = body_json(response).await;
    assert_eq!(public["openaiKey"]["set"], false);
    let stored: Option<String> = sqlx::query_scalar("SELECT openai_api_key FROM user_ai_settings")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert!(stored.is_none());
}

#[tokio::test]
async fn ai_cannot_be_enabled_without_the_selected_provider_key() {
    let app = TestApp::new().await;
    let (_user_id, cookie) = signed_in_owner(&app).await;
    let response = json_with_cookie(
        &app,
        "PUT",
        "/api/ai/settings",
        &cookie,
        settings(None, true),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn invalid_parameter_combinations_are_rejected_before_any_provider_call() {
    let app = TestApp::new().await;
    let (_user_id, cookie) = signed_in_owner(&app).await;
    let mut invalid = settings(Some("sk-test"), true);
    invalid["openaiModel"] = json!("gpt-5");
    invalid["openaiReasoning"] = json!("none");
    invalid["temperature"] = json!(0.4);
    let response = json_with_cookie(&app, "PUT", "/api/ai/settings", &cookie, invalid).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn empty_text_and_existing_summaries_are_refused_without_network_calls() {
    let app = TestApp::new().await;
    let (_user_id, cookie) = signed_in_owner(&app).await;
    let empty_id = app.insert_row("Scan", "scan.pdf", "pdf", 10).await;
    sqlx::query("UPDATE documents SET text_status = 'empty' WHERE id = ?")
        .bind(empty_id)
        .execute(&app.db)
        .await
        .unwrap();
    let response = json_with_cookie(
        &app,
        "POST",
        &format!("/api/documents/{empty_id}/summarize"),
        &cookie,
        json!({}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let existing_id = app.insert_row("Notes", "notes.md", "md", 10).await;
    sqlx::query(
        "UPDATE documents SET text_status = 'ok', extracted_text = 'Readable body', summary = 'Hand written' WHERE id = ?",
    )
    .bind(existing_id)
    .execute(&app.db)
    .await
    .unwrap();
    let response = json_with_cookie(
        &app,
        "POST",
        &format!("/api/documents/{existing_id}/summarize"),
        &cookie,
        json!({ "overwrite": false }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);

    let disabled_id = app.insert_row("Readable", "readable.txt", "txt", 10).await;
    sqlx::query("UPDATE documents SET text_status = 'ok', extracted_text = 'Ready to summarize' WHERE id = ?")
        .bind(disabled_id)
        .execute(&app.db)
        .await
        .unwrap();
    let response = json_with_cookie(
        &app,
        "POST",
        &format!("/api/documents/{disabled_id}/summarize"),
        &cookie,
        json!({}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ai_keys_and_preferences_are_isolated_per_user() {
    let app = TestApp::new().await;
    let (owner_id, owner_cookie) = signed_in_owner(&app).await;
    sqlx::query("INSERT INTO github_invitations (github_login, invited_by) VALUES ('reader', ?)")
        .bind(owner_id)
        .execute(&app.db)
        .await
        .unwrap();
    let reader_id = auth::resolve_github_user(
        &state_of(&app),
        &GitHubIdentity {
            id: 202,
            login: "reader".into(),
            avatar_url: None,
        },
    )
    .await
    .unwrap();
    let reader_session = auth::create_session(&state_of(&app), reader_id)
        .await
        .unwrap();
    let reader_cookie = format!("kintara_session={reader_session}");

    assert_eq!(
        json_with_cookie(
            &app,
            "PUT",
            "/api/ai/settings",
            &owner_cookie,
            settings(Some("sk-owner-1111"), true)
        )
        .await
        .status(),
        StatusCode::OK
    );
    let reader = body_json(
        json_with_cookie(&app, "GET", "/api/ai/settings", &reader_cookie, json!({})).await,
    )
    .await;
    assert_eq!(reader["enabled"], false);
    assert_eq!(reader["openaiKey"]["set"], false);
}
