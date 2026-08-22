mod common;

use axum::http::StatusCode;
use common::{
    TestApp, ai_settings as settings, body_json, invited_user, json_with_cookie, signed_in_owner,
};
use serde_json::json;

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

    let mut invalid_google = settings(Some("sk-test"), true);
    invalid_google["googleModel"] = json!("gemini-2.5-pro");
    let response = json_with_cookie(&app, "PUT", "/api/ai/settings", &cookie, invalid_google).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn removed_google_models_fall_back_to_the_current_default() {
    let app = TestApp::new().await;
    let (user_id, cookie) = signed_in_owner(&app).await;
    assert_eq!(
        json_with_cookie(
            &app,
            "PUT",
            "/api/ai/settings",
            &cookie,
            settings(Some("sk-test"), true),
        )
        .await
        .status(),
        StatusCode::OK
    );
    sqlx::query(
        "UPDATE user_ai_settings SET google_model = 'gemini-2.5-pro',
         google_thinking = 'low' WHERE user_id = ?",
    )
    .bind(user_id)
    .execute(&app.db)
    .await
    .unwrap();

    let settings =
        body_json(json_with_cookie(&app, "GET", "/api/ai/settings", &cookie, json!({})).await)
            .await;
    assert_eq!(settings["googleModel"], "gemini-3.7-flash");
    assert_eq!(settings["googleThinking"], "low");
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
    let reader_id = invited_user(&app, owner_id, "reader", 202).await;
    let reader_cookie = app.session_cookie_for(reader_id).await;

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

#[tokio::test]
async fn document_conversations_are_private_even_when_the_document_is_shared() {
    let app = TestApp::new().await;
    let (owner_id, _owner_cookie) = signed_in_owner(&app).await;
    let reader_id = invited_user(&app, owner_id, "reader", 303).await;
    let document_id = app.insert_row("Shared", "shared.md", "md", 10).await;
    let library_id: i64 = sqlx::query_scalar(
        "INSERT INTO libraries (owner_id, name) VALUES (?, 'Shared library') RETURNING id",
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
        .bind(reader_id)
        .execute(&app.db)
        .await
        .unwrap();

    for (user_id, content) in [(owner_id, "Owner question"), (reader_id, "Reader question")] {
        let conversation_id: i64 = sqlx::query_scalar(
            "INSERT INTO ai_conversations (user_id, document_id) VALUES (?, ?) RETURNING id",
        )
        .bind(user_id)
        .bind(document_id)
        .fetch_one(&app.db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO ai_messages (conversation_id, role, kind, content)
             VALUES (?, 'user', 'question', ?)",
        )
        .bind(conversation_id)
        .bind(content)
        .execute(&app.db)
        .await
        .unwrap();
    }

    let owner = body_json(
        app.get_as(
            &format!("/api/ai/documents/{document_id}/conversation"),
            owner_id,
        )
        .await,
    )
    .await;
    let reader = body_json(
        app.get_as(
            &format!("/api/ai/documents/{document_id}/conversation"),
            reader_id,
        )
        .await,
    )
    .await;
    assert_eq!(owner["messages"][0]["content"], "Owner question");
    assert_eq!(reader["messages"][0]["content"], "Reader question");

    let cleared = app
        .send_json_as(
            "DELETE",
            &format!("/api/ai/documents/{document_id}/conversation"),
            json!({}),
            reader_id,
        )
        .await;
    assert_eq!(cleared.status(), StatusCode::NO_CONTENT);

    let owner_after = body_json(
        app.get_as(
            &format!("/api/ai/documents/{document_id}/conversation"),
            owner_id,
        )
        .await,
    )
    .await;
    let reader_after = body_json(
        app.get_as(
            &format!("/api/ai/documents/{document_id}/conversation"),
            reader_id,
        )
        .await,
    )
    .await;
    assert_eq!(owner_after["messages"][0]["content"], "Owner question");
    assert_eq!(reader_after["conversationId"], serde_json::Value::Null);
    assert_eq!(reader_after["messages"], json!([]));
}
