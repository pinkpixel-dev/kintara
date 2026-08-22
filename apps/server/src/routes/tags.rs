use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::access;
use crate::current_user::CurrentUser;
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

pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
) -> AppResult<Json<Vec<Tag>>> {
    let tags = sqlx::query_as::<_, Tag>(
        "SELECT t.id, t.name, t.color,
                (SELECT COUNT(*) FROM document_tags dt
                 JOIN documents d ON d.id = dt.document_id
                 WHERE dt.tag_id = t.id AND (d.owner_id = ? OR EXISTS (
                    SELECT 1 FROM library_documents ld
                    JOIN libraries l ON l.id = ld.library_id
                    LEFT JOIN library_members lm
                      ON lm.library_id = l.id AND lm.user_id = ?
                    WHERE ld.document_id = d.id
                      AND (l.owner_id = ? OR lm.user_id IS NOT NULL)
                 ))) AS document_count
         FROM tags t
         WHERE t.owner_id = ? OR EXISTS (
            SELECT 1 FROM document_tags dt
            JOIN documents d ON d.id = dt.document_id
            WHERE dt.tag_id = t.id AND (d.owner_id = ? OR EXISTS (
                SELECT 1 FROM library_documents ld
                JOIN libraries l ON l.id = ld.library_id
                LEFT JOIN library_members lm
                  ON lm.library_id = l.id AND lm.user_id = ?
                WHERE ld.document_id = d.id
                  AND (l.owner_id = ? OR lm.user_id IS NOT NULL)
            ))
         )
         ORDER BY t.name COLLATE NOCASE ASC",
    )
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
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
    CurrentUser(user_id): CurrentUser,
    Json(body): Json<CreateTag>,
) -> AppResult<(StatusCode, Json<Tag>)> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name cannot be empty".into()));
    }

    let existing: Option<i64> =
        sqlx::query_scalar("SELECT id FROM tags WHERE owner_id = ? AND name = ?")
            .bind(user_id)
            .bind(name)
            .fetch_optional(&state.db)
            .await?;

    if let Some(id) = existing {
        return Ok((StatusCode::OK, Json(fetch(&state, id, user_id).await?)));
    }

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO tags (owner_id, name, color) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(user_id)
    .bind(name)
    .bind(&body.color)
    .fetch_one(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(fetch(&state, id, user_id).await?),
    ))
}

pub async fn delete(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<StatusCode> {
    let owned: Option<i64> = sqlx::query_scalar("SELECT id FROM tags WHERE id = ? AND owner_id = ?")
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;
    if owned.is_none() {
        return Err(AppError::NotFound);
    }
    let used: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM document_tags WHERE tag_id = ?")
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    if used != 0 {
        return Err(AppError::Conflict(
            "remove this tag from its documents before deleting it".into(),
        ));
    }
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
    CurrentUser(user_id): CurrentUser,
    Path(document_id): Path<i64>,
) -> AppResult<Json<Vec<Tag>>> {
    access::require_document_view(&state, document_id, user_id).await?;
    let tags = sqlx::query_as::<_, Tag>(
        "SELECT t.id, t.name, t.color, 0 AS document_count
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
    CurrentUser(user_id): CurrentUser,
    Path((document_id, tag_id)): Path<(i64, i64)>,
) -> AppResult<StatusCode> {
    access::require_document_editor(&state, document_id, user_id).await?;
    let tag_owned: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM tags WHERE id = ? AND owner_id = ?)",
    )
    .bind(tag_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if tag_owned == 0 {
        return Err(AppError::NotFound);
    }
    sqlx::query("INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)")
        .bind(document_id)
        .bind(tag_id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn detach(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path((document_id, tag_id)): Path<(i64, i64)>,
) -> AppResult<StatusCode> {
    access::require_document_editor(&state, document_id, user_id).await?;
    sqlx::query("DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?")
        .bind(document_id)
        .bind(tag_id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn fetch(state: &AppState, id: i64, user_id: i64) -> AppResult<Tag> {
    sqlx::query_as::<_, Tag>(
        "SELECT t.id, t.name, t.color, 0 AS document_count
         FROM tags t WHERE t.id = ? AND t.owner_id = ?",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)
}
