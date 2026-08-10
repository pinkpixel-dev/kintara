use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

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
    Query(query): Query<ListQuery>,
) -> AppResult<Json<Vec<Collection>>> {
    const SQL: &str = "
        SELECT c.id, c.library_id, c.name,
               (SELECT COUNT(*) FROM document_collections dc WHERE dc.collection_id = c.id)
                   AS document_count
        FROM collections c
        WHERE (?1 IS NULL OR c.library_id = ?1)
        ORDER BY c.name COLLATE NOCASE ASC";

    let collections = sqlx::query_as::<_, Collection>(SQL)
        .bind(query.library_id)
        .fetch_all(&state.db)
        .await?;

    Ok(Json(collections))
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateCollection>,
) -> AppResult<(StatusCode, Json<Collection>)> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name cannot be empty".into()));
    }

    // Checked explicitly so a bad library id reads as 404 rather than surfacing
    // as an opaque foreign key violation.
    let library_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM libraries WHERE id = ?")
        .bind(body.library_id)
        .fetch_optional(&state.db)
        .await?;
    if library_exists.is_none() {
        return Err(AppError::NotFound);
    }

    let id: i64 =
        sqlx::query_scalar("INSERT INTO collections (library_id, name) VALUES (?, ?) RETURNING id")
            .bind(body.library_id)
            .bind(name)
            .fetch_one(&state.db)
            .await?;

    Ok((StatusCode::CREATED, Json(fetch(&state, id).await?)))
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateCollection>,
) -> AppResult<Json<Collection>> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name cannot be empty".into()));
    }

    let result = sqlx::query("UPDATE collections SET name = ? WHERE id = ?")
        .bind(name)
        .bind(id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(Json(fetch(&state, id).await?))
}

pub async fn delete(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<StatusCode> {
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
    Path((id, document_id)): Path<(i64, i64)>,
) -> AppResult<StatusCode> {
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
    Path((id, document_id)): Path<(i64, i64)>,
) -> AppResult<StatusCode> {
    sqlx::query("DELETE FROM document_collections WHERE collection_id = ? AND document_id = ?")
        .bind(id)
        .bind(document_id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn fetch(state: &AppState, id: i64) -> AppResult<Collection> {
    sqlx::query_as::<_, Collection>(
        "SELECT c.id, c.library_id, c.name,
                (SELECT COUNT(*) FROM document_collections dc WHERE dc.collection_id = c.id)
                    AS document_count
         FROM collections c WHERE c.id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)
}
