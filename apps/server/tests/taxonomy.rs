mod common;

use axum::http::StatusCode;
use common::{body_json, TestApp};
use serde_json::json;


// ---------------------------------------------------- libraries
#[tokio::test]
async fn libraries_can_be_created_listed_renamed_and_deleted() {
    let app = TestApp::new().await;

    let created = body_json(
        app.send_json(
            "POST",
            "/api/libraries",
            json!({ "name": "Papers", "icon": "BookOpen", "iconColor": "#410186" }),
        )
        .await,
    )
    .await;
    let id = created["id"].as_i64().unwrap();
    assert_eq!(created["name"], "Papers");
    assert_eq!(created["icon"], "BookOpen");
    assert_eq!(created["documentCount"], 0);

    let renamed = body_json(
        app.send_json(
            "PATCH",
            &format!("/api/libraries/{id}"),
            json!({ "name": "Research" }),
        )
        .await,
    )
    .await;
    assert_eq!(renamed["name"], "Research");
    assert_eq!(renamed["icon"], "BookOpen", "icon should be untouched");

    assert_eq!(
        app.delete(&format!("/api/libraries/{id}")).await.status(),
        StatusCode::NO_CONTENT
    );

    let listed = body_json(app.get("/api/libraries").await).await;
    assert_eq!(listed.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn a_duplicate_library_name_is_a_conflict_rather_than_a_500() {
    let app = TestApp::new().await;

    app.send_json("POST", "/api/libraries", json!({ "name": "Papers" }))
        .await;
    let response = app
        .send_json("POST", "/api/libraries", json!({ "name": "Papers" }))
        .await;

    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn library_membership_drives_the_document_count_and_filter() {
    let app = TestApp::new().await;
    let doc = app.add_document("paper.pdf", b"bytes").await;
    let library = body_json(
        app.send_json("POST", "/api/libraries", json!({ "name": "Papers" }))
            .await,
    )
    .await;
    let library_id = library["id"].as_i64().unwrap();

    app.post(&format!("/api/libraries/{library_id}/documents/{doc}"))
        .await;

    let listed = body_json(app.get("/api/libraries").await).await;
    assert_eq!(listed[0]["documentCount"], 1);

    app.delete(&format!("/api/libraries/{library_id}/documents/{doc}"))
        .await;

    let listed = body_json(app.get("/api/libraries").await).await;
    assert_eq!(listed[0]["documentCount"], 0);
}

#[tokio::test]
async fn deleting_a_library_does_not_delete_its_documents() {
    let app = TestApp::new().await;
    let doc = app.add_document("paper.pdf", b"bytes").await;
    let library = body_json(
        app.send_json("POST", "/api/libraries", json!({ "name": "Papers" }))
            .await,
    )
    .await;
    let library_id = library["id"].as_i64().unwrap();
    app.post(&format!("/api/libraries/{library_id}/documents/{doc}"))
        .await;

    app.delete(&format!("/api/libraries/{library_id}")).await;

    // A library is a view over documents, not a container that owns them.
    let listed = body_json(app.get("/api/documents").await).await;
    assert_eq!(listed["total"], 1);
    assert!(app.config.library_dir.join("paper.pdf").exists());
}

// ---------------------------------------------------- collections
#[tokio::test]
async fn collections_are_scoped_to_their_library() {
    let app = TestApp::new().await;

    let a = body_json(
        app.send_json("POST", "/api/libraries", json!({ "name": "A" }))
            .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let b = body_json(
        app.send_json("POST", "/api/libraries", json!({ "name": "B" }))
            .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();

    app.send_json(
        "POST",
        "/api/collections",
        json!({ "libraryId": a, "name": "2026" }),
    )
    .await;
    app.send_json(
        "POST",
        "/api/collections",
        json!({ "libraryId": b, "name": "Fiction" }),
    )
    .await;

    let scoped = body_json(app.get(&format!("/api/collections?libraryId={a}")).await).await;
    assert_eq!(scoped.as_array().unwrap().len(), 1);
    assert_eq!(scoped[0]["name"], "2026");

    let all = body_json(app.get("/api/collections").await).await;
    assert_eq!(all.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn a_collection_under_a_missing_library_is_404_not_a_constraint_error() {
    let app = TestApp::new().await;

    let response = app
        .send_json(
            "POST",
            "/api/collections",
            json!({ "libraryId": 9999, "name": "Orphan" }),
        )
        .await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn deleting_a_library_cascades_to_its_collections() {
    let app = TestApp::new().await;
    let library = body_json(
        app.send_json("POST", "/api/libraries", json!({ "name": "Papers" }))
            .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();

    app.send_json(
        "POST",
        "/api/collections",
        json!({ "libraryId": library, "name": "2026" }),
    )
    .await;

    app.delete(&format!("/api/libraries/{library}")).await;

    let all = body_json(app.get("/api/collections").await).await;
    assert_eq!(all.as_array().unwrap().len(), 0);
}

// ---------------------------------------------------- tags
#[tokio::test]
async fn creating_a_tag_that_already_exists_returns_the_existing_one() {
    let app = TestApp::new().await;

    let first = app
        .send_json("POST", "/api/tags", json!({ "name": "physics" }))
        .await;
    assert_eq!(first.status(), StatusCode::CREATED);
    let first_id = body_json(first).await["id"].as_i64().unwrap();

    // Tagging is a high-frequency free-text action; a repeat is expected input,
    // not an error worth showing the user.
    let second = app
        .send_json("POST", "/api/tags", json!({ "name": "physics" }))
        .await;
    assert_eq!(second.status(), StatusCode::OK);
    assert_eq!(body_json(second).await["id"].as_i64().unwrap(), first_id);

    let all = body_json(app.get("/api/tags").await).await;
    assert_eq!(all.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn tags_attach_to_and_detach_from_documents() {
    let app = TestApp::new().await;
    let doc = app.add_document("paper.pdf", b"bytes").await;
    let tag = body_json(
        app.send_json("POST", "/api/tags", json!({ "name": "physics" }))
            .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();

    app.post(&format!("/api/documents/{doc}/tags/{tag}")).await;

    let on_doc = body_json(app.get(&format!("/api/documents/{doc}/tags")).await).await;
    assert_eq!(on_doc.as_array().unwrap().len(), 1);
    assert_eq!(on_doc[0]["name"], "physics");

    let filtered = body_json(app.get(&format!("/api/documents?tagId={tag}")).await).await;
    assert_eq!(filtered["total"], 1);

    app.delete(&format!("/api/documents/{doc}/tags/{tag}")).await;

    let on_doc = body_json(app.get(&format!("/api/documents/{doc}/tags")).await).await;
    assert_eq!(on_doc.as_array().unwrap().len(), 0);
}

// ---------------------------------------------------- annotations
#[tokio::test]
async fn annotations_round_trip_and_delete() {
    let app = TestApp::new().await;
    let doc = app.add_document("paper.pdf", b"bytes").await;

    let created = app
        .send_json(
            "POST",
            "/api/annotations",
            json!({
                "documentId": doc,
                "annotationType": "highlight",
                "serializedPosition": "{\"page\":1,\"x\":0.1,\"y\":0.2,\"w\":0.3,\"h\":0.05}",
                "color": "#410186"
            }),
        )
        .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let annotation = body_json(created).await;
    let annotation_id = annotation["id"].as_i64().unwrap();
    assert_eq!(annotation["color"], "#410186");

    let listed = body_json(app.get(&format!("/api/documents/{doc}/annotations")).await).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);
    // The position blob is opaque to the server and must come back byte-identical.
    assert_eq!(
        listed[0]["serializedPosition"],
        "{\"page\":1,\"x\":0.1,\"y\":0.2,\"w\":0.3,\"h\":0.05}"
    );

    assert_eq!(
        app.delete(&format!("/api/annotations/{annotation_id}"))
            .await
            .status(),
        StatusCode::NO_CONTENT
    );

    let listed = body_json(app.get(&format!("/api/documents/{doc}/annotations")).await).await;
    assert_eq!(listed.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn an_invalid_annotation_type_is_a_400_not_a_constraint_error() {
    let app = TestApp::new().await;
    let doc = app.add_document("paper.pdf", b"bytes").await;

    let response = app
        .send_json(
            "POST",
            "/api/annotations",
            json!({
                "documentId": doc,
                "annotationType": "scribble",
                "serializedPosition": "{}"
            }),
        )
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn annotating_a_missing_document_is_404() {
    let app = TestApp::new().await;

    let response = app
        .send_json(
            "POST",
            "/api/annotations",
            json!({
                "documentId": 9999,
                "annotationType": "highlight",
                "serializedPosition": "{}"
            }),
        )
        .await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn one_users_annotations_are_not_visible_or_deletable_by_another() {
    let app = TestApp::new().await;
    let doc = app.add_document("paper.pdf", b"bytes").await;

    // A second user, as multi-user installs will have once auth lands.
    let other: i64 = sqlx::query_scalar(
        "INSERT INTO users (username, password_hash) VALUES ('other', '') RETURNING id",
    )
    .fetch_one(&app.db)
    .await
    .unwrap();

    let foreign: i64 = sqlx::query_scalar(
        "INSERT INTO annotations (document_id, user_id, annotation_type, serialized_position)
         VALUES (?, ?, 'highlight', '{}') RETURNING id",
    )
    .bind(doc)
    .bind(other)
    .fetch_one(&app.db)
    .await
    .unwrap();

    let listed = body_json(app.get(&format!("/api/documents/{doc}/annotations")).await).await;
    assert_eq!(
        listed.as_array().unwrap().len(),
        0,
        "another user's highlights must not be visible"
    );

    assert_eq!(
        app.delete(&format!("/api/annotations/{foreign}"))
            .await
            .status(),
        StatusCode::NOT_FOUND,
        "another user's highlights must not be deletable"
    );
}
