use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::access;
use crate::current_user::CurrentUser;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: i64,
    pub library_id: i64,
    pub name: String,
    pub document_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCollection {
    pub library_id: i64,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCollection {
    pub name: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    /// Restricts the listing to one library. The sidebar always scopes by
    /// library; omitting it returns every collection.
    #[serde(default)]
    pub library_id: Option<i64>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", axum::routing::patch(update).delete(delete))
        .route(
            "/{id}/documents/{document_id}",
            post(add_document).delete(remove_document),
        )
}

pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<Vec<Collection>>> {
    const SQL: &str = "
        SELECT c.id, c.library_id, c.name,
               (SELECT COUNT(*) FROM document_collections dc WHERE dc.collection_id = c.id)
                   AS document_count
        FROM collections c
        JOIN libraries l ON l.id = c.library_id
        LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?1
        WHERE (l.owner_id = ?1 OR lm.user_id IS NOT NULL)
          AND (?2 IS NULL OR c.library_id = ?2)
        ORDER BY c.name COLLATE NOCASE ASC";

    let collections = sqlx::query_as::<_, Collection>(SQL)
        .bind(user_id)
        .bind(query.library_id)
        .fetch_all(&state.db)
        .await?;

    Ok(Json(collections))
}

pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Json(body): Json<CreateCollection>,
) -> AppResult<(StatusCode, Json<Collection>)> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name cannot be empty".into()));
    }

    access::require_library_editor(&state, body.library_id, user_id).await?;

    let id: i64 =
        sqlx::query_scalar("INSERT INTO collections (library_id, name) VALUES (?, ?) RETURNING id")
            .bind(body.library_id)
            .bind(name)
            .fetch_one(&state.db)
            .await?;

    Ok((
        StatusCode::CREATED,
        Json(fetch(&state, id, user_id).await?),
    ))
}

pub async fn update(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<UpdateCollection>,
) -> AppResult<Json<Collection>> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name cannot be empty".into()));
    }

    let library_id: i64 = sqlx::query_scalar("SELECT library_id FROM collections WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    access::require_library_editor(&state, library_id, user_id).await?;

    let result = sqlx::query("UPDATE collections SET name = ? WHERE id = ?")
        .bind(name)
        .bind(id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(Json(fetch(&state, id, user_id).await?))
}

pub async fn delete(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<StatusCode> {
    let library_id: i64 = sqlx::query_scalar("SELECT library_id FROM collections WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    access::require_library_editor(&state, library_id, user_id).await?;
    let result = sqlx::query("DELETE FROM collections WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_document(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path((id, document_id)): Path<(i64, i64)>,
) -> AppResult<StatusCode> {
    let library_id: i64 = sqlx::query_scalar("SELECT library_id FROM collections WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    access::require_library_editor(&state, library_id, user_id).await?;
    access::require_document_owner(&state, document_id, user_id).await?;
    sqlx::query("INSERT OR IGNORE INTO library_documents (library_id, document_id) VALUES (?, ?)")
        .bind(library_id)
        .bind(document_id)
        .execute(&state.db)
        .await?;
    sqlx::query(
        "INSERT OR IGNORE INTO document_collections (collection_id, document_id) VALUES (?, ?)",
    )
    .bind(id)
    .bind(document_id)
    .execute(&state.db)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_document(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path((id, document_id)): Path<(i64, i64)>,
) -> AppResult<StatusCode> {
    let library_id: i64 = sqlx::query_scalar("SELECT library_id FROM collections WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    access::require_library_editor(&state, library_id, user_id).await?;
    sqlx::query("DELETE FROM document_collections WHERE collection_id = ? AND document_id = ?")
        .bind(id)
        .bind(document_id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn fetch(state: &AppState, id: i64, user_id: i64) -> AppResult<Collection> {
    sqlx::query_as::<_, Collection>(
        "SELECT c.id, c.library_id, c.name,
                (SELECT COUNT(*) FROM document_collections dc WHERE dc.collection_id = c.id)
                    AS document_count
         FROM collections c
         JOIN libraries l ON l.id = c.library_id
         LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
         WHERE c.id = ? AND (l.owner_id = ? OR lm.user_id IS NOT NULL)",
    )
    .bind(user_id)
    .bind(id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)
}
