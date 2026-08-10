//! Shared test scaffolding. Every helper here builds the real router over a
//! real SQLite file and a real library directory on disk.

use std::net::SocketAddr;
use std::path::Path;

use axum::body::Body;
use axum::http::Request;
use axum::response::Response;
use http_body_util::BodyExt;
use kintara_server::config::Config;
use kintara_server::state::AppState;
use kintara_server::{db, routes};
use sqlx::SqlitePool;

pub struct TestApp {
    pub router: axum::Router,
    pub db: SqlitePool,
    pub config: Config,
    _dir: tempfile::TempDir,
}

impl TestApp {
    pub async fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");

        let config = Config {
            library_dir: dir.path().join("library"),
            data_dir: dir.path().to_path_buf(),
            web_dir: dir.path().join("web"),
            bind: "127.0.0.1:0".parse::<SocketAddr>().unwrap(),
        };
        config.ensure_dirs().expect("create dirs");
        std::fs::create_dir_all(&config.web_dir).expect("create web dir");
        std::fs::write(config.web_dir.join("index.html"), "<!doctype html>spa")
            .expect("write index.html");

        let db = db::connect(&config.database_path()).await.expect("db");
        let router = routes::router(AppState::new(db.clone(), config.clone()));

        Self {
            router,
            db,
            config,
            _dir: dir,
        }
    }

    pub async fn get(&self, uri: &str) -> Response {
        self.request(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
    }

    pub async fn get_with_range(&self, uri: &str, range: &str) -> Response {
        self.request(
            Request::builder()
                .uri(uri)
                .header("Range", range)
                .body(Body::empty())
                .unwrap(),
        )
        .await
    }

    pub async fn request(&self, request: Request<Body>) -> Response {
        use tower::ServiceExt;
        self.router.clone().oneshot(request).await.unwrap()
    }

    /// Writes a real file into the library and indexes it.
    pub async fn add_document(&self, relative_path: &str, contents: &[u8]) -> i64 {
        let full = self.config.library_dir.join(relative_path);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).expect("create parent dir");
        }
        std::fs::write(&full, contents).expect("write document");

        let document_type = Path::new(relative_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin")
            .to_string();

        let title = Path::new(relative_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string();

        self.insert_row(&title, relative_path, &document_type, contents.len() as i64)
            .await
    }

    /// Inserts a document row without writing a file. Used to test what happens
    /// when the database and the filesystem disagree.
    pub async fn insert_row(
        &self,
        title: &str,
        relative_path: &str,
        document_type: &str,
        file_size: i64,
    ) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO documents (title, relative_path, document_type, file_size)
             VALUES (?, ?, ?, ?) RETURNING id",
        )
        .bind(title)
        .bind(relative_path)
        .bind(document_type)
        .bind(file_size)
        .fetch_one(&self.db)
        .await
        .expect("insert document")
    }

    pub async fn user_id(&self) -> i64 {
        sqlx::query_scalar("SELECT id FROM users ORDER BY id LIMIT 1")
            .fetch_one(&self.db)
            .await
            .expect("seeded user")
    }
}

pub async fn body_bytes(response: Response) -> Vec<u8> {
    response.into_body().collect().await.unwrap().to_bytes().to_vec()
}

pub async fn body_string(response: Response) -> String {
    String::from_utf8(body_bytes(response).await).unwrap()
}

pub async fn body_json(response: Response) -> serde_json::Value {
    serde_json::from_str(&body_string(response).await).expect("valid json")
}

pub fn header(response: &Response, name: &str) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_string())
}
