mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::{body_json, header, TestApp};
use serde_json::json;

async fn setup_owner(app: &TestApp) -> String {
    let response = app
        .send_json(
            "POST",
            "/api/auth/setup",
            json!({ "username": "jess", "password": "a-good-password" }),
        )
        .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let cookie = header(&response, "set-cookie").expect("session cookie");
    cookie.split(';').next().unwrap().to_string()
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
async fn a_fresh_install_reports_that_it_needs_setup() {
    let app = TestApp::new().await;

    let status = body_json(app.get("/api/auth/status").await).await;
    assert_eq!(status["needsSetup"], true);
    assert_eq!(status["authenticated"], false);
}

#[tokio::test]
async fn the_library_is_reachable_before_a_password_is_set() {
    let app = TestApp::new().await;
    app.add_document("paper.pdf", b"bytes").await;

    // Otherwise a first run could not scan, and the setup screen would sit in
    // front of an app that returns 401 for everything.
    let response = app.get("/api/documents").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn setup_creates_the_owner_and_signs_them_in() {
    let app = TestApp::new().await;
    let cookie = setup_owner(&app).await;

    let me = body_json(get_with_cookie(&app, "/api/me", &cookie).await).await;
    assert_eq!(me["username"], "jess");
    assert_eq!(me["isAdmin"], true);

    let status = body_json(app.get("/api/auth/status").await).await;
    assert_eq!(status["needsSetup"], false);
}

#[tokio::test]
async fn setup_reuses_the_seeded_account_so_existing_reading_state_survives() {
    let app = TestApp::new().await;
    let id = app.add_document("paper.pdf", b"bytes").await;
    let seeded_user = app.user_id().await;

    sqlx::query("INSERT INTO user_document_state (user_id, document_id, reading_progress) VALUES (?, ?, 0.6)")
        .bind(seeded_user)
        .bind(id)
        .execute(&app.db)
        .await
        .unwrap();

    let cookie = setup_owner(&app).await;

    // Documents indexed by the scanner before setup should still show their
    // progress once the owner signs in, rather than belonging to a ghost user.
    let doc = body_json(get_with_cookie(&app, &format!("/api/documents/{id}"), &cookie).await).await;
    assert_eq!(doc["readingProgress"], 0.6);

    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(users, 1, "setup must not create a second account");
}

#[tokio::test]
async fn setup_cannot_be_run_twice() {
    let app = TestApp::new().await;
    setup_owner(&app).await;

    // Otherwise anyone reaching the server could seize an existing install.
    let response = app
        .send_json(
            "POST",
            "/api/auth/setup",
            json!({ "username": "attacker", "password": "another-password" }),
        )
        .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn short_passwords_are_rejected() {
    let app = TestApp::new().await;

    let response = app
        .send_json("POST", "/api/auth/setup", json!({ "username": "jess", "password": "short" }))
        .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn once_a_password_exists_the_api_requires_a_session() {
    let app = TestApp::new().await;
    app.add_document("paper.pdf", b"bytes").await;
    setup_owner(&app).await;

    let response = app.get("/api/documents").await;
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "the library must not be readable without signing in"
    );
}

#[tokio::test]
async fn a_valid_login_returns_a_working_session() {
    let app = TestApp::new().await;
    app.add_document("paper.pdf", b"bytes").await;
    setup_owner(&app).await;

    let response = app
        .send_json(
            "POST",
            "/api/auth/login",
            json!({ "username": "jess", "password": "a-good-password" }),
        )
        .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let cookie = header(&response, "set-cookie").expect("session cookie");
    assert!(cookie.contains("HttpOnly"), "session cookie must not be script-readable");

    let session = cookie.split(';').next().unwrap();
    let response = get_with_cookie(&app, "/api/documents", session).await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_wrong_password_is_rejected_without_revealing_whether_the_user_exists() {
    let app = TestApp::new().await;
    setup_owner(&app).await;

    let wrong_password = app
        .send_json(
            "POST",
            "/api/auth/login",
            json!({ "username": "jess", "password": "not-the-password" }),
        )
        .await;
    let unknown_user = app
        .send_json(
            "POST",
            "/api/auth/login",
            json!({ "username": "nobody", "password": "not-the-password" }),
        )
        .await;

    assert_eq!(wrong_password.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(unknown_user.status(), StatusCode::UNAUTHORIZED);

    let a = body_json(wrong_password).await;
    let b = body_json(unknown_user).await;
    assert_eq!(a["error"], b["error"], "the two cases must be indistinguishable");
}

#[tokio::test]
async fn logging_out_revokes_the_session_server_side() {
    let app = TestApp::new().await;
    app.add_document("paper.pdf", b"bytes").await;
    let cookie = setup_owner(&app).await;

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

    // Sessions live in the database, so the old cookie is dead rather than
    // merely cleared in the browser.
    let response = get_with_cookie(&app, "/api/documents", &cookie).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_made_up_session_cookie_is_rejected() {
    let app = TestApp::new().await;
    setup_owner(&app).await;

    let response = get_with_cookie(&app, "/api/documents", "kintara_session=made-up").await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn an_expired_session_stops_working() {
    let app = TestApp::new().await;
    let cookie = setup_owner(&app).await;

    sqlx::query("UPDATE sessions SET expires_at = datetime('now', '-1 day')")
        .execute(&app.db)
        .await
        .unwrap();

    let response = get_with_cookie(&app, "/api/documents", &cookie).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn deleting_a_user_takes_their_sessions_with_them() {
    let app = TestApp::new().await;
    setup_owner(&app).await;

    sqlx::query("DELETE FROM users").execute(&app.db).await.unwrap();

    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(sessions, 0);
}
