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
