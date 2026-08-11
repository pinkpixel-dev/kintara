//! Shared test scaffolding. Every helper here builds the real router over a
//! real SQLite file and a real library directory on disk.
//!
//! This module is compiled into each integration-test binary separately, so
//! helpers a given binary does not use look like dead code. That is expected
//! rather than a sign anything is unused.
#![allow(dead_code)]

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
            // Tests drive the scanner explicitly; a background watcher would
            // race their assertions.
            scan_on_start: false,
            watch: false,
            max_upload_bytes: 64 * 1024 * 1024,
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

    pub async fn send_json(&self, method: &str, uri: &str, body: serde_json::Value) -> Response {
        self.request(
            Request::builder()
                .method(method)
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
    }

    pub async fn post(&self, uri: &str) -> Response {
        self.request(
            Request::builder()
                .method("POST")
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
    }

    pub async fn delete(&self, uri: &str) -> Response {
        self.request(
            Request::builder()
                .method("DELETE")
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
    }

    /// Posts a `multipart/form-data` upload, hand-building the body so the test
    /// exercises the same parsing path a browser would produce.
    pub async fn upload(&self, filename: &str, contents: &[u8], fields: &[(&str, &str)]) -> Response {
        const BOUNDARY: &str = "kintaratestboundary";
        let mut body: Vec<u8> = Vec::new();

        for (name, value) in fields {
            body.extend_from_slice(format!("--{BOUNDARY}\r\n").as_bytes());
            body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
            );
            body.extend_from_slice(value.as_bytes());
            body.extend_from_slice(b"\r\n");
        }

        body.extend_from_slice(format!("--{BOUNDARY}\r\n").as_bytes());
        body.extend_from_slice(
            format!(
                "Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n\
                 Content-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(contents);
        body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());

        self.request(
            Request::builder()
                .method("POST")
                .uri("/api/documents")
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={BOUNDARY}"),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
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

    /// Creates a library through the API and returns its id.
    pub async fn create_library(&self, name: &str) -> i64 {
        body_json(
            self.send_json("POST", "/api/libraries", serde_json::json!({ "name": name }))
                .await,
        )
        .await["id"]
            .as_i64()
            .expect("library id")
    }

    /// Creates a collection through the API and returns its id.
    pub async fn create_collection(&self, library_id: i64, name: &str) -> i64 {
        body_json(
            self.send_json(
                "POST",
                "/api/collections",
                serde_json::json!({ "libraryId": library_id, "name": name }),
            )
            .await,
        )
        .await["id"]
            .as_i64()
            .expect("collection id")
    }

    /// Creates a tag if it does not exist and attaches it to a document.
    pub async fn tag_document(&self, document_id: i64, name: &str) -> i64 {
        // Creating an existing tag returns the existing row, so callers can tag
        // several documents with the same name without checking first.
        let tag_id = body_json(
            self.send_json("POST", "/api/tags", serde_json::json!({ "name": name }))
                .await,
        )
        .await["id"]
            .as_i64()
            .expect("tag id");

        self.post(&format!("/api/documents/{document_id}/tags/{tag_id}"))
            .await;

        tag_id
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

/// A real, minimal PDF so metadata extraction and thumbnail generation run the
/// same path they will in production.
pub fn sample_pdf() -> Vec<u8> {
    let mut objects: Vec<(usize, Vec<u8>)> = Vec::new();
    objects.push((1, b"<< /Type /Catalog /Pages 2 0 R >>".to_vec()));
    objects.push((2, b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec()));
    objects.push((
        3,
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>".to_vec(),
    ));
    let stream = b"BT /F1 12 Tf 20 100 Td (kintara) Tj ET";
    objects.push((
        4,
        [
            format!("<< /Length {} >>\nstream\n", stream.len()).as_bytes(),
            stream,
            b"\nendstream",
        ]
        .concat(),
    ));

    let mut out: Vec<u8> = b"%PDF-1.4\n".to_vec();
    let mut offsets = vec![0usize; objects.len() + 1];
    for (num, body) in &objects {
        offsets[*num] = out.len();
        out.extend_from_slice(format!("{num} 0 obj\n").as_bytes());
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n");
    }

    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    out.extend_from_slice(b"0000000000 65535 f \n");
    for num in 1..=objects.len() {
        out.extend_from_slice(format!("{:010} 00000 n \n", offsets[num]).as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    out
}
