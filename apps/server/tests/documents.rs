mod common;

use axum::http::StatusCode;
use common::{body_bytes, body_json, header, TestApp};

/// Known bytes so Range assertions can be exact rather than approximate.
const SAMPLE: &[u8] = b"0123456789ABCDEF";

#[tokio::test]
async fn an_empty_library_lists_nothing() {
    let app = TestApp::new().await;

    let response = app.get("/api/documents").await;
    assert_eq!(response.status(), StatusCode::OK);

    let json = body_json(response).await;
    assert_eq!(json["total"], 0);
    assert_eq!(json["items"].as_array().unwrap().len(), 0);
    assert_eq!(json["limit"], 50);
}

#[tokio::test]
async fn documents_are_listed_with_per_user_state_defaulted() {
    let app = TestApp::new().await;
    app.add_document("papers/attention.pdf", SAMPLE).await;

    let json = body_json(app.get("/api/documents").await).await;
    assert_eq!(json["total"], 1);

    let item = &json["items"][0];
    assert_eq!(item["title"], "attention");
    assert_eq!(item["documentType"], "pdf");
    assert_eq!(item["fileSize"], SAMPLE.len());
    // No user_document_state row exists, so these come from the LEFT JOIN's
    // COALESCE rather than from a backfilled row.
    assert_eq!(item["readingProgress"], 0.0);
    assert_eq!(item["isFavorite"], false);
    assert_eq!(item["hasThumbnail"], false);
}

#[tokio::test]
async fn the_wire_format_never_exposes_filesystem_paths() {
    let app = TestApp::new().await;
    app.add_document("papers/attention.pdf", SAMPLE).await;

    let raw = common::body_string(app.get("/api/documents").await).await;

    assert!(
        !raw.contains("relativePath") && !raw.contains("relative_path"),
        "document paths must not be published to clients: {raw}"
    );
    assert!(
        !raw.contains("papers/attention.pdf"),
        "document paths must not be published to clients: {raw}"
    );
}

#[tokio::test]
async fn paging_reports_total_independently_of_the_page() {
    let app = TestApp::new().await;
    for i in 0..5 {
        app.add_document(&format!("doc{i}.pdf"), SAMPLE).await;
    }

    let json = body_json(app.get("/api/documents?limit=2&offset=0").await).await;
    assert_eq!(json["total"], 5, "total must count matches, not the page");
    assert_eq!(json["items"].as_array().unwrap().len(), 2);

    let json = body_json(app.get("/api/documents?limit=2&offset=4").await).await;
    assert_eq!(json["items"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn limit_is_clamped_so_one_request_cannot_ask_for_everything() {
    let app = TestApp::new().await;

    let json = body_json(app.get("/api/documents?limit=100000").await).await;
    assert_eq!(json["limit"], 200);

    let json = body_json(app.get("/api/documents?limit=0&offset=-5").await).await;
    assert_eq!(json["limit"], 1);
    assert_eq!(json["offset"], 0);
}

#[tokio::test]
async fn search_matches_titles_and_prefixes() {
    let app = TestApp::new().await;
    app.add_document("papers/attention.pdf", SAMPLE).await;
    app.add_document("books/rust.pdf", SAMPLE).await;

    let json = body_json(app.get("/api/documents?q=attention").await).await;
    assert_eq!(json["total"], 1);
    assert_eq!(json["items"][0]["title"], "attention");

    // Incremental search: a partial word should still match.
    let json = body_json(app.get("/api/documents?q=atten").await).await;
    assert_eq!(json["total"], 1);
}

#[tokio::test]
async fn search_with_fts_punctuation_does_not_error() {
    let app = TestApp::new().await;
    app.add_document("papers/cpp.pdf", SAMPLE).await;

    // Each of these is either a syntax error or a surprising operator in raw
    // FTS5. Searching for "C++" must not 500 the server.
    for query in ["C%2B%2B", "%22", "*", "AND", "foo%20OR%20bar", "-x", "()"] {
        let response = app.get(&format!("/api/documents?q={query}")).await;
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "query {query} should not error"
        );
    }
}

#[tokio::test]
async fn a_search_with_no_usable_characters_returns_nothing_not_everything() {
    let app = TestApp::new().await;
    app.add_document("papers/attention.pdf", SAMPLE).await;

    let json = body_json(app.get("/api/documents?q=%2B%2B%2B").await).await;
    assert_eq!(
        json["total"], 0,
        "an unusable search must not fall back to listing the whole library"
    );
}

#[tokio::test]
async fn the_favorite_filter_uses_the_requesting_users_state() {
    let app = TestApp::new().await;
    let kept = app.add_document("kept.pdf", SAMPLE).await;
    app.add_document("other.pdf", SAMPLE).await;
    let user_id = app.user_id().await;

    sqlx::query(
        "INSERT INTO user_document_state (user_id, document_id, is_favorite) VALUES (?, ?, 1)",
    )
    .bind(user_id)
    .bind(kept)
    .execute(&app.db)
    .await
    .unwrap();

    let json = body_json(app.get("/api/documents?favorite=true").await).await;
    assert_eq!(json["total"], 1);
    assert_eq!(json["items"][0]["id"], kept);
    assert_eq!(json["items"][0]["isFavorite"], true);
}

#[tokio::test]
async fn sorting_by_title_is_case_insensitive() {
    let app = TestApp::new().await;
    app.insert_row("zebra", "z.pdf", "pdf", 1).await;
    app.insert_row("Apple", "a.pdf", "pdf", 1).await;

    let json = body_json(app.get("/api/documents?sort=title").await).await;
    assert_eq!(json["items"][0]["title"], "Apple");
    assert_eq!(json["items"][1]["title"], "zebra");
}

#[tokio::test]
async fn a_single_document_can_be_fetched_and_missing_ones_are_404() {
    let app = TestApp::new().await;
    let id = app.add_document("papers/attention.pdf", SAMPLE).await;

    let json = body_json(app.get(&format!("/api/documents/{id}")).await).await;
    assert_eq!(json["id"], id);

    let response = app.get("/api/documents/999999").await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_file_endpoint_serves_the_whole_document_with_a_pdf_content_type() {
    let app = TestApp::new().await;
    let id = app.add_document("papers/attention.pdf", SAMPLE).await;

    let response = app.get(&format!("/api/documents/{id}/file")).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        header(&response, "content-type").as_deref(),
        Some("application/pdf")
    );
    // Without this pdf.js cannot fetch page ranges and re-downloads the whole
    // document on every page turn.
    assert_eq!(header(&response, "accept-ranges").as_deref(), Some("bytes"));

    assert_eq!(body_bytes(response).await, SAMPLE);
}

#[tokio::test]
async fn the_file_endpoint_honours_range_requests_exactly() {
    let app = TestApp::new().await;
    let id = app.add_document("papers/attention.pdf", SAMPLE).await;

    let response = app
        .get_with_range(&format!("/api/documents/{id}/file"), "bytes=5-9")
        .await;

    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        header(&response, "content-range").as_deref(),
        Some("bytes 5-9/16")
    );
    assert_eq!(body_bytes(response).await, b"56789");
}

#[tokio::test]
async fn an_open_ended_range_serves_to_the_end_of_the_document() {
    let app = TestApp::new().await;
    let id = app.add_document("papers/attention.pdf", SAMPLE).await;

    let response = app
        .get_with_range(&format!("/api/documents/{id}/file"), "bytes=12-")
        .await;

    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(body_bytes(response).await, b"CDEF");
}

#[tokio::test]
async fn an_unsatisfiable_range_is_rejected() {
    let app = TestApp::new().await;
    let id = app.add_document("papers/attention.pdf", SAMPLE).await;

    let response = app
        .get_with_range(&format!("/api/documents/{id}/file"), "bytes=9999-99999")
        .await;

    assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
}

#[tokio::test]
async fn markdown_and_text_documents_get_readable_content_types() {
    let app = TestApp::new().await;
    let md = app.add_document("notes.md", b"# hello").await;
    let txt = app.add_document("notes.txt", b"hello").await;

    let response = app.get(&format!("/api/documents/{md}/file")).await;
    assert_eq!(
        header(&response, "content-type").as_deref(),
        Some("text/markdown; charset=utf-8")
    );

    let response = app.get(&format!("/api/documents/{txt}/file")).await;
    assert_eq!(
        header(&response, "content-type").as_deref(),
        Some("text/plain; charset=utf-8")
    );
}

#[tokio::test]
async fn download_asks_the_browser_to_save_under_the_original_filename() {
    let app = TestApp::new().await;
    let id = app.add_document("papers/attention is all you need.pdf", SAMPLE).await;

    let response = app.get(&format!("/api/documents/{id}/download")).await;
    assert_eq!(response.status(), StatusCode::OK);

    let disposition = header(&response, "content-disposition").expect("content-disposition");
    assert!(disposition.starts_with("attachment;"), "got {disposition}");
    assert!(
        disposition.contains("filename*=UTF-8''attention%20is%20all%20you%20need.pdf"),
        "got {disposition}"
    );
    assert_eq!(body_bytes(response).await, SAMPLE);
}

#[tokio::test]
async fn download_handles_non_ascii_filenames() {
    let app = TestApp::new().await;
    let id = app.add_document("naïve café.pdf", SAMPLE).await;

    let response = app.get(&format!("/api/documents/{id}/download")).await;
    assert_eq!(response.status(), StatusCode::OK);

    // A raw UTF-8 byte in a header value would make this unbuildable, so the
    // ASCII fallback and the percent-encoded form both have to be present.
    let disposition = header(&response, "content-disposition").expect("content-disposition");
    assert!(disposition.contains("filename=\""), "got {disposition}");
    assert!(disposition.contains("filename*=UTF-8''"), "got {disposition}");
}

#[tokio::test]
async fn a_document_row_pointing_outside_the_library_is_not_served() {
    let app = TestApp::new().await;

    // Simulates a bad scanner or a hand-edited row. The file genuinely exists,
    // so only the containment check can stop this being served.
    let outside = app.config.data_dir.join("outside.txt");
    std::fs::write(&outside, b"secret").unwrap();

    let id = app.insert_row("Escape", "../outside.txt", "txt", 6).await;

    let response = app.get(&format!("/api/documents/{id}/file")).await;
    assert_ne!(
        response.status(),
        StatusCode::OK,
        "traversal outside the library root must never be served"
    );

    let body = common::body_string(response).await;
    assert!(!body.contains("secret"), "leaked file contents: {body}");
}

#[tokio::test]
async fn a_missing_file_on_disk_is_404_rather_than_a_500() {
    let app = TestApp::new().await;
    // Row exists, file never written — the normal state after someone deletes
    // a file from the share directly.
    let id = app.insert_row("Ghost", "ghost.pdf", "pdf", 10).await;

    let response = app.get(&format!("/api/documents/{id}/file")).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_document_without_a_thumbnail_is_404() {
    let app = TestApp::new().await;
    let id = app.add_document("papers/attention.pdf", SAMPLE).await;

    let response = app.get(&format!("/api/documents/{id}/thumbnail")).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_generated_thumbnail_is_served_and_cacheable() {
    let app = TestApp::new().await;
    let id = app.add_document("papers/attention.pdf", SAMPLE).await;

    std::fs::write(app.config.thumbnail_dir().join("t1.jpg"), b"jpegbytes").unwrap();
    sqlx::query("UPDATE documents SET thumbnail_name = 't1.jpg' WHERE id = ?")
        .bind(id)
        .execute(&app.db)
        .await
        .unwrap();

    let response = app.get(&format!("/api/documents/{id}/thumbnail")).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        header(&response, "content-type").as_deref(),
        Some("image/jpeg")
    );
    assert!(header(&response, "cache-control")
        .unwrap_or_default()
        .contains("max-age"));
    assert_eq!(body_bytes(response).await, b"jpegbytes");
}
