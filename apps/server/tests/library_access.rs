mod common;

use axum::http::StatusCode;
use common::{TestApp, body_json};
use serde_json::json;

async fn owner_id(app: &TestApp) -> i64 {
    sqlx::query_scalar("SELECT id FROM users ORDER BY is_admin DESC, id LIMIT 1")
        .fetch_one(&app.db)
        .await
        .expect("owner")
}

async fn add_user(app: &TestApp, username: &str, github_id: i64) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO users (username, github_user_id, is_admin)
         VALUES (?, ?, 0) RETURNING id",
    )
    .bind(username)
    .bind(github_id)
    .fetch_one(&app.db)
    .await
    .expect("user")
}

#[tokio::test]
async fn private_libraries_and_documents_are_isolated_and_names_are_per_owner() {
    let app = TestApp::new().await;
    let owner = owner_id(&app).await;
    let tyler = add_user(&app, "tyler", 22002).await;

    app.send_json("POST", "/api/libraries", json!({ "name": "Recipes" }))
        .await;
    let created = app
        .send_json_as(
            "POST",
            "/api/libraries",
            json!({ "name": "Recipes" }),
            tyler,
        )
        .await;
    assert_eq!(created.status(), StatusCode::CREATED);

    let owner_libraries = body_json(app.get("/api/libraries").await).await;
    let tyler_libraries = body_json(app.get_as("/api/libraries", tyler).await).await;
    assert_eq!(owner_libraries.as_array().unwrap().len(), 1);
    assert_eq!(tyler_libraries.as_array().unwrap().len(), 1);
    assert_eq!(owner_libraries[0]["accessRole"], "owner");
    assert_eq!(tyler_libraries[0]["accessRole"], "owner");
    assert_ne!(owner_libraries[0]["id"], tyler_libraries[0]["id"]);

    let document = app
        .add_document("private/recipe.pdf", b"private recipe")
        .await;
    let hidden = app
        .get_as(&format!("/api/documents/{document}"), tyler)
        .await;
    assert_eq!(hidden.status(), StatusCode::NOT_FOUND);
    let tyler_documents = body_json(app.get_as("/api/documents", tyler).await).await;
    assert_eq!(tyler_documents["total"], 0);

    let stored_owner: i64 = sqlx::query_scalar("SELECT owner_id FROM documents WHERE id = ?")
        .bind(document)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(stored_owner, owner);
}

#[tokio::test]
async fn sharing_grants_viewer_then_editor_access_but_never_file_deletion() {
    let app = TestApp::new().await;
    let owner_username: String =
        sqlx::query_scalar("SELECT username FROM users ORDER BY is_admin DESC, id LIMIT 1")
            .fetch_one(&app.db)
            .await
            .unwrap();
    let tyler = add_user(&app, "tyler", 22003).await;
    let document = app.add_document("crochet/pattern.pdf", b"pattern").await;
    let library = app.create_library("Crochet").await;
    app.post(&format!("/api/libraries/{library}/documents/{document}"))
        .await;

    let shared = app
        .send_json(
            "POST",
            &format!("/api/libraries/{library}/members"),
            json!({ "username": "tyler", "role": "viewer" }),
        )
        .await;
    assert_eq!(shared.status(), StatusCode::CREATED);

    let libraries = body_json(app.get_as("/api/libraries", tyler).await).await;
    assert_eq!(libraries[0]["name"], "Crochet");
    assert_eq!(libraries[0]["accessRole"], "viewer");
    assert_eq!(libraries[0]["ownerUsername"], owner_username);
    assert_eq!(
        app.get_as(&format!("/api/documents/{document}"), tyler)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        app.send_json_as(
            "PATCH",
            &format!("/api/documents/{document}"),
            json!({ "title": "Changed" }),
            tyler,
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );

    app.send_json(
        "PATCH",
        &format!("/api/libraries/{library}/members/{tyler}"),
        json!({ "role": "editor" }),
    )
    .await;
    assert_eq!(
        app.send_json_as(
            "PATCH",
            &format!("/api/documents/{document}"),
            json!({ "title": "Shared pattern" }),
            tyler,
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.send_json_as(
            "POST",
            "/api/collections",
            json!({ "libraryId": library, "name": "Magazines" }),
            tyler,
        )
        .await
        .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        app.request_as(
            axum::http::Request::builder()
                .method("DELETE")
                .uri(format!("/api/documents/{document}"))
                .body(axum::body::Body::empty())
                .unwrap(),
            tyler,
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    assert!(app.config.library_dir.join("crochet/pattern.pdf").exists());
}

#[tokio::test]
async fn revoking_a_library_removes_its_documents_from_every_read_path() {
    let app = TestApp::new().await;
    let tyler = add_user(&app, "tyler", 22004).await;
    let document = app.add_document("shared/manual.pdf", b"manual").await;
    let library = app.create_library("Household").await;
    app.post(&format!("/api/libraries/{library}/documents/{document}"))
        .await;
    app.send_json(
        "POST",
        &format!("/api/libraries/{library}/members"),
        json!({ "username": "tyler", "role": "viewer" }),
    )
    .await;

    assert_eq!(
        app.get_as(&format!("/api/documents/{document}/file"), tyler)
            .await
            .status(),
        StatusCode::OK
    );

    app.request(
        axum::http::Request::builder()
            .method("DELETE")
            .uri(format!("/api/libraries/{library}/members/{tyler}"))
            .header(
                axum::http::header::COOKIE,
                app.session_cookie_for(owner_id(&app).await).await,
            )
            .body(axum::body::Body::empty())
            .unwrap(),
    )
    .await;

    assert_eq!(
        app.get_as(&format!("/api/documents/{document}"), tyler)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.get_as(&format!("/api/documents/{document}/file"), tyler)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        body_json(app.get_as("/api/documents", tyler).await).await["total"],
        0
    );
}
