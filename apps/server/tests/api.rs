//! HTTP-level tests. These drive the real router with a real database behind
//! it, so a broken route, a broken query, or a broken migration all surface
//! here rather than only at runtime.

use std::net::SocketAddr;
use std::path::PathBuf;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use kintara_server::config::Config;
use kintara_server::state::AppState;
use kintara_server::{db, routes};
use tower::ServiceExt;

/// Builds the app over a throwaway database and a throwaway web root. The
/// TempDir is returned so the caller keeps it alive for the test's duration.
async fn test_app() -> (tempfile::TempDir, axum::Router) {
    let dir = tempfile::tempdir().expect("tempdir");

    let config = Config {
        library_dir: dir.path().join("library"),
        data_dir: dir.path().to_path_buf(),
        web_dir: dir.path().join("web"),
        bind: "127.0.0.1:0".parse::<SocketAddr>().unwrap(),
        // Tests drive the scanner explicitly; a background watcher would race
        // their assertions.
        scan_on_start: false,
        watch: false,
        max_upload_bytes: 64 * 1024 * 1024,
        github_oauth: None,
    };
    config.ensure_dirs().expect("create dirs");
    std::fs::create_dir_all(&config.web_dir).expect("create web dir");
    std::fs::write(config.web_dir.join("index.html"), "<!doctype html>spa")
        .expect("write index.html");

    let pool = db::connect(&config.database_path()).await.expect("db");
    let app = routes::router(AppState::new(pool, config));

    (dir, app)
}

async fn body_string(response: axum::response::Response) -> String {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn get(uri: &str) -> Request<Body> {
    Request::builder().uri(uri).body(Body::empty()).unwrap()
}

#[tokio::test]
async fn health_reports_ok_and_reaches_the_database() {
    let (_dir, app) = test_app().await;

    let response = app.oneshot(get("/api/health")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = body_string(response).await;
    assert!(
        body.contains("\"status\":\"ok\""),
        "unexpected body: {body}"
    );
    // A document count only comes back if the query actually ran, which makes
    // this a real database check rather than a static string.
    assert!(body.contains("\"documents\":0"), "unexpected body: {body}");
    assert!(
        body.contains(env!("CARGO_PKG_VERSION")),
        "health should report the crate version, got: {body}"
    );
}

#[tokio::test]
async fn unknown_api_routes_are_not_swallowed_by_the_spa_fallback() {
    let (_dir, app) = test_app().await;

    let response = app.oneshot(get("/api/does-not-exist")).await.unwrap();

    // If this ever returns 200 with HTML, the SPA fallback has been wired too
    // broadly and every client-side fetch bug will look like a parse error.
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn client_side_routes_fall_back_to_the_spa_index() {
    let (_dir, app) = test_app().await;

    let response = app.oneshot(get("/library/42")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = body_string(response).await;
    assert!(body.contains("spa"), "expected index.html, got: {body}");
}

#[tokio::test]
async fn config_defaults_are_relative_so_local_runs_need_no_setup() {
    // Guards against someone "helpfully" changing the defaults to /library and
    // /data, which would make `cargo run` fail outside a container.
    temp_env_cleared(|| {
        let config = Config::from_env().expect("default config should be valid");
        assert!(config.library_dir.is_relative());
        assert!(config.data_dir.is_relative());
        assert_eq!(config.bind.port(), 8080);
    });
}

fn temp_env_cleared(f: impl FnOnce()) {
    let keys = [
        "KINTARA_LIBRARY_DIR",
        "KINTARA_DATA_DIR",
        "KINTARA_WEB_DIR",
        "KINTARA_BIND",
    ];
    let saved: Vec<(&str, Option<String>)> =
        keys.iter().map(|k| (*k, std::env::var(k).ok())).collect();

    for key in keys {
        unsafe { std::env::remove_var(key) };
    }

    f();

    for (key, value) in saved {
        if let Some(value) = value {
            unsafe { std::env::set_var(key, value) };
        }
    }
}

/// Sanity check that the database file lands inside the data directory rather
/// than the library share, which is the mistake that corrupts SQLite on a NAS.
#[test]
fn database_lives_in_the_data_dir_not_the_library() {
    let config = Config {
        library_dir: PathBuf::from("/library"),
        data_dir: PathBuf::from("/data"),
        web_dir: PathBuf::from("/app/web"),
        bind: "0.0.0.0:8080".parse().unwrap(),
        scan_on_start: false,
        watch: false,
        max_upload_bytes: 64 * 1024 * 1024,
        github_oauth: None,
    };

    assert!(config.database_path().starts_with("/data"));
    assert!(!config.database_path().starts_with("/library"));
    assert!(config.thumbnail_dir().starts_with("/data"));
}
