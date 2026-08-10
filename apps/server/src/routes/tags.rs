use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub document_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTag {
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", axum::routing::delete(delete))
}

pub async fn list(State(state): State<AppState>) -> AppResult<Json<Vec<Tag>>> {
    let tags = sqlx::query_as::<_, Tag>(
        "SELECT t.id, t.name, t.color,
                (SELECT COUNT(*) FROM document_tags dt WHERE dt.tag_id = t.id) AS document_count
         FROM tags t
         ORDER BY t.name COLLATE NOCASE ASC",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(tags))
}

/// Creates a tag, or returns the existing one with that name.
///
/// Tagging is a high-frequency action taken from a free-text field, so a
/// duplicate name is an expected outcome rather than an error worth surfacing
/// to the user.
pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateTag>,
) -> AppResult<(StatusCode, Json<Tag>)> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name cannot be empty".into()));
    }

    let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM tags WHERE name = ?")
        .bind(name)
        .fetch_optional(&state.db)
        .await?;

    if let Some(id) = existing {
        return Ok((StatusCode::OK, Json(fetch(&state, id).await?)));
    }

    let id: i64 = sqlx::query_scalar("INSERT INTO tags (name, color) VALUES (?, ?) RETURNING id")
        .bind(name)
        .bind(&body.color)
        .fetch_one(&state.db)
        .await?;

    Ok((StatusCode::CREATED, Json(fetch(&state, id).await?)))
}

pub async fn delete(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<StatusCode> {
    let result = sqlx::query("DELETE FROM tags WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Tags on one document. Mounted under `/documents/{id}/tags`.
pub async fn for_document(
    State(state): State<AppState>,
    Path(document_id): Path<i64>,
) -> AppResult<Json<Vec<Tag>>> {
    let tags = sqlx::query_as::<_, Tag>(
        "SELECT t.id, t.name, t.color,
                (SELECT COUNT(*) FROM document_tags dt WHERE dt.tag_id = t.id) AS document_count
         FROM tags t
         JOIN document_tags dt ON dt.tag_id = t.id
         WHERE dt.document_id = ?
         ORDER BY t.name COLLATE NOCASE ASC",
    )
    .bind(document_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(tags))
}

pub async fn attach(
    State(state): State<AppState>,
    Path((document_id, tag_id)): Path<(i64, i64)>,
) -> AppResult<StatusCode> {
    sqlx::query("INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)")
        .bind(document_id)
        .bind(tag_id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn detach(
    State(state): State<AppState>,
    Path((document_id, tag_id)): Path<(i64, i64)>,
) -> AppResult<StatusCode> {
    sqlx::query("DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?")
        .bind(document_id)
        .bind(tag_id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn fetch(state: &AppState, id: i64) -> AppResult<Tag> {
    sqlx::query_as::<_, Tag>(
        "SELECT t.id, t.name, t.color,
                (SELECT COUNT(*) FROM document_tags dt WHERE dt.tag_id = t.id) AS document_count
         FROM tags t WHERE t.id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)
}
