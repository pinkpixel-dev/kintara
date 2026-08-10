mod common;

use axum::http::StatusCode;
use common::{body_json, sample_pdf, TestApp};
use serde_json::json;


// ---------------------------------------------------- uploads
#[tokio::test]
async fn uploading_a_pdf_indexes_it_and_writes_it_into_the_library() {
    let app = TestApp::new().await;

    let response = app.upload("my-paper.pdf", &sample_pdf(), &[]).await;
    assert_eq!(response.status(), StatusCode::CREATED);

    let doc = body_json(response).await;
    assert_eq!(doc["title"], "my paper", "title should come from the filename");
    assert_eq!(doc["documentType"], "pdf");
    assert!(doc["fileSize"].as_i64().unwrap() > 0);

    // The file must actually exist on disk, not just in the database.
    assert!(app.config.library_dir.join("my-paper.pdf").exists());

    let listed = body_json(app.get("/api/documents").await).await;
    assert_eq!(listed["total"], 1);
}

#[tokio::test]
async fn uploading_the_same_file_twice_is_a_conflict_not_a_duplicate() {
    let app = TestApp::new().await;
    let pdf = sample_pdf();

    assert_eq!(
        app.upload("paper.pdf", &pdf, &[]).await.status(),
        StatusCode::CREATED
    );

    // Same bytes, different name — content hashing should still catch it.
    let response = app.upload("paper-copy.pdf", &pdf, &[]).await;
    assert_eq!(response.status(), StatusCode::CONFLICT);

    let listed = body_json(app.get("/api/documents").await).await;
    assert_eq!(listed["total"], 1, "the library must not gain a duplicate");
}

#[tokio::test]
async fn two_different_documents_may_share_a_filename() {
    let app = TestApp::new().await;

    assert_eq!(
        app.upload("paper.pdf", b"%PDF-1.4 first", &[]).await.status(),
        StatusCode::CREATED
    );
    let response = app.upload("paper.pdf", b"%PDF-1.4 second", &[]).await;
    assert_eq!(response.status(), StatusCode::CREATED);

    // relative_path is UNIQUE, so the second one has to be renamed rather than
    // failing or overwriting the first.
    assert!(app.config.library_dir.join("paper.pdf").exists());
    assert!(app.config.library_dir.join("paper (2).pdf").exists());
}

#[tokio::test]
async fn an_upload_filename_cannot_escape_the_library() {
    let app = TestApp::new().await;

    let response = app
        .upload("../../../etc/passwd.pdf", b"%PDF-1.4 x", &[])
        .await;
    assert_eq!(response.status(), StatusCode::CREATED);

    // The traversal components are stripped, so it lands in the library root.
    assert!(app.config.library_dir.join("passwd.pdf").exists());
    assert!(!app.config.library_dir.join("../../../etc/passwd.pdf").exists());
}

#[tokio::test]
async fn unsupported_file_types_are_rejected() {
    let app = TestApp::new().await;

    let response = app.upload("virus.exe", b"MZ", &[]).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let listed = body_json(app.get("/api/documents").await).await;
    assert_eq!(listed["total"], 0);
}

#[tokio::test]
async fn an_empty_upload_is_rejected() {
    let app = TestApp::new().await;
    assert_eq!(
        app.upload("empty.pdf", b"", &[]).await.status(),
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn an_upload_can_be_filed_into_a_library_on_arrival() {
    let app = TestApp::new().await;

    let library = body_json(
        app.send_json("POST", "/api/libraries", json!({ "name": "Papers" }))
            .await,
    )
    .await;
    let library_id = library["id"].as_i64().unwrap();

    let response = app
        .upload(
            "filed.pdf",
            &sample_pdf(),
            &[("libraryId", &library_id.to_string())],
        )
        .await;
    assert_eq!(response.status(), StatusCode::CREATED);

    let listed = body_json(
        app.get(&format!("/api/documents?libraryId={library_id}"))
            .await,
    )
    .await;
    assert_eq!(listed["total"], 1);
}

#[tokio::test]
async fn an_upload_larger_than_axums_default_body_limit_succeeds() {
    let app = TestApp::new().await;

    // axum's DefaultBodyLimit is 2 MB. Real documents — magazines especially —
    // are far bigger, so anything under the configured ceiling must go through.
    let mut big = sample_pdf();
    big.extend(std::iter::repeat(b'%').take(5 * 1024 * 1024));

    let response = app.upload("magazine.pdf", &big, &[]).await;
    assert_eq!(
        response.status(),
        StatusCode::CREATED,
        "a 5 MB upload must not be rejected as a malformed multipart request"
    );

    let doc = body_json(response).await;
    assert_eq!(doc["fileSize"].as_i64().unwrap(), big.len() as i64);
}

#[tokio::test]
async fn a_failed_upload_does_not_leave_a_temp_file_behind() {
    let app = TestApp::new().await;
    let pdf = sample_pdf();

    assert_eq!(app.upload("a.pdf", &pdf, &[]).await.status(), StatusCode::CREATED);
    // Same content, so this is rejected after the bytes have been streamed to
    // the incoming directory.
    assert_eq!(app.upload("b.pdf", &pdf, &[]).await.status(), StatusCode::CONFLICT);

    let incoming = app.config.library_dir.join(".kintara-incoming");
    let leftovers = std::fs::read_dir(&incoming)
        .map(|entries| entries.count())
        .unwrap_or(0);
    assert_eq!(leftovers, 0, "a rejected upload must not leave a partial file");
}

#[tokio::test]
async fn the_incoming_directory_is_never_indexed() {
    let app = TestApp::new().await;
    let incoming = app.config.library_dir.join(".kintara-incoming");
    std::fs::create_dir_all(&incoming).unwrap();
    std::fs::write(incoming.join("stray.pdf"), sample_pdf()).unwrap();

    kintara_server::scanner::full_scan(&kintara_server::state::AppState::new(
        app.db.clone(),
        app.config.clone(),
    ))
    .await
    .unwrap();

    let listed = body_json(app.get("/api/documents").await).await;
    assert_eq!(listed["total"], 0, "in-flight uploads must not appear in the library");
}

#[tokio::test]
async fn nas_metadata_directories_are_ignored() {
    let app = TestApp::new().await;

    // Synology keeps thumbnails in @eaDir and deleted files in #recycle; both
    // are full of documents that should not show up in the library.
    for dir in ["@eaDir", "#recycle"] {
        let path = app.config.library_dir.join(dir);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(path.join("ghost.pdf"), sample_pdf()).unwrap();
    }
    std::fs::write(app.config.library_dir.join("real.pdf"), sample_pdf()).unwrap();

    kintara_server::scanner::full_scan(&kintara_server::state::AppState::new(
        app.db.clone(),
        app.config.clone(),
    ))
    .await
    .unwrap();

    let listed = body_json(app.get("/api/documents").await).await;
    assert_eq!(listed["total"], 1);
    assert_eq!(listed["items"][0]["title"], "real");
}
