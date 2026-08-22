mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::{TestApp, body_json};
use kintara_server::auth::{self, GitHubIdentity};
use kintara_server::state::AppState;

fn state_of(app: &TestApp) -> AppState {
    AppState::new(app.db.clone(), app.config.clone())
}

async fn claim_owner(app: &TestApp) -> (i64, String) {
    let state = state_of(app);
    let id = auth::resolve_github_user(
        &state,
        &GitHubIdentity {
            id: 101,
            login: "jess".into(),
            avatar_url: Some("https://avatars.githubusercontent.com/u/101".into()),
        },
    )
    .await
    .unwrap();
    let session = auth::create_session(&state, id).await.unwrap();
    (id, format!("kintara_session={session}"))
}

async fn get_with_cookie(app: &TestApp, uri: &str, cookie: &str) -> axum::response::Response {
    app.request(
        Request::builder()
            .uri(uri)
            .header("Cookie", cookie)
            .body(Body::empty())
            .unwrap(),
    )
    .await
}

#[tokio::test]
async fn a_fresh_install_reports_owner_setup_and_missing_oauth_configuration() {
    let app = TestApp::new().await;
    let status = body_json(app.get_unauthenticated("/api/auth/status").await).await;
    assert_eq!(status["needsOwner"], true);
    assert_eq!(status["oauthConfigured"], false);
    assert_eq!(status["authenticated"], false);
}

#[tokio::test]
async fn oauth_callback_state_must_belong_to_the_same_browser() {
    let app = TestApp::new().await;
    let response = app
        .get_unauthenticated("/api/auth/github/callback?code=temporary&state=not-this-browser")
        .await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn the_library_is_private_before_an_owner_is_linked() {
    let app = TestApp::new().await;
    app.add_document("paper.pdf", b"bytes").await;
    assert_eq!(
        app.get_unauthenticated("/api/documents").await.status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn first_github_identity_reuses_seeded_owner_and_reading_state() {
    let app = TestApp::new().await;
    let document_id = app.add_document("paper.pdf", b"bytes").await;
    let seeded_user = app.user_id().await;
    sqlx::query(
        "INSERT INTO user_document_state (user_id, document_id, reading_progress)
         VALUES (?, ?, 0.6)",
    )
    .bind(seeded_user)
    .bind(document_id)
    .execute(&app.db)
    .await
    .unwrap();

    let (owner_id, cookie) = claim_owner(&app).await;
    assert_eq!(owner_id, seeded_user);
    let document =
        body_json(get_with_cookie(&app, &format!("/api/documents/{document_id}"), &cookie).await)
            .await;
    assert_eq!(document["readingProgress"], 0.6);
}

#[tokio::test]
async fn an_uninvited_github_user_is_rejected() {
    let app = TestApp::new().await;
    claim_owner(&app).await;
    let result = auth::resolve_github_user(
        &state_of(&app),
        &GitHubIdentity {
            id: 202,
            login: "not-invited".into(),
            avatar_url: None,
        },
    )
    .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn an_invited_github_user_gets_an_account_and_consumes_the_invitation() {
    let app = TestApp::new().await;
    let (owner_id, _) = claim_owner(&app).await;
    sqlx::query(
        "INSERT INTO github_invitations (github_login, is_admin, invited_by)
         VALUES ('reader', 0, ?)",
    )
    .bind(owner_id)
    .execute(&app.db)
    .await
    .unwrap();

    let reader_id = auth::resolve_github_user(
        &state_of(&app),
        &GitHubIdentity {
            id: 202,
            login: "Reader".into(),
            avatar_url: None,
        },
    )
    .await
    .unwrap();
    let github_id: i64 = sqlx::query_scalar("SELECT github_user_id FROM users WHERE id = ?")
        .bind(reader_id)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(github_id, 202);
    let invitations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM github_invitations")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(invitations, 0);
}

#[tokio::test]
async fn once_an_owner_exists_the_api_requires_a_session() {
    let app = TestApp::new().await;
    app.add_document("paper.pdf", b"bytes").await;
    claim_owner(&app).await;
    assert_eq!(
        app.get_unauthenticated("/api/documents").await.status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn a_valid_kintara_session_allows_library_access() {
    let app = TestApp::new().await;
    app.add_document("paper.pdf", b"bytes").await;
    let (_, cookie) = claim_owner(&app).await;
    assert_eq!(
        get_with_cookie(&app, "/api/documents", &cookie)
            .await
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn logging_out_revokes_the_session_server_side() {
    let app = TestApp::new().await;
    let (_, cookie) = claim_owner(&app).await;
    let response = app
        .request(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header("Cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        get_with_cookie(&app, "/api/documents", &cookie)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn expired_and_made_up_sessions_are_rejected() {
    let app = TestApp::new().await;
    let (_, cookie) = claim_owner(&app).await;
    sqlx::query("UPDATE sessions SET expires_at = datetime('now', '-1 day')")
        .execute(&app.db)
        .await
        .unwrap();
    for invalid in [&cookie, "kintara_session=made-up"] {
        assert_eq!(
            get_with_cookie(&app, "/api/documents", invalid)
                .await
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
}

#[tokio::test]
async fn deleting_a_user_cascades_to_sessions() {
    let app = TestApp::new().await;
    let (owner_id, _) = claim_owner(&app).await;
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(owner_id)
        .execute(&app.db)
        .await
        .unwrap();
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(sessions, 0);
}

#[tokio::test]
async fn a_member_cannot_manage_access() {
    let app = TestApp::new().await;
    let (owner_id, _) = claim_owner(&app).await;
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
    let session = auth::create_session(&state_of(&app), reader_id)
        .await
        .unwrap();
    let response = get_with_cookie(&app, "/api/users", &format!("kintara_session={session}")).await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
