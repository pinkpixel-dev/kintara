use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::access;
use crate::current_user::CurrentUser;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: i64,
    pub document_id: i64,
    pub annotation_type: String,
    /// Opaque to the server. The Markdown reader stores a text offset range and
    /// the PDF reader stores `{page, x, y, w, h}`; the server only round-trips it.
    pub serialized_position: String,
    pub content: Option<String>,
    pub color: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAnnotation {
    pub document_id: i64,
    pub annotation_type: String,
    pub serialized_position: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

/// Annotations on one document, for the requesting user only.
/// Mounted under `/documents/{id}/annotations`.
pub async fn for_document(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(document_id): Path<i64>,
) -> AppResult<Json<Vec<Annotation>>> {
    access::require_document_view(&state, document_id, user_id).await?;
    let annotations = sqlx::query_as::<_, Annotation>(
        "SELECT id, document_id, annotation_type, serialized_position, content, color, created_at
         FROM annotations
         WHERE document_id = ? AND user_id = ?
         ORDER BY created_at ASC",
    )
    .bind(document_id)
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(annotations))
}

pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Json(body): Json<CreateAnnotation>,
) -> AppResult<(StatusCode, Json<Annotation>)> {
    // Mirrors the CHECK constraint so a typo reads as a 400 rather than an
    // opaque constraint failure.
    if !matches!(body.annotation_type.as_str(), "highlight" | "note") {
        return Err(AppError::BadRequest(
            "annotationType must be 'highlight' or 'note'".into(),
        ));
    }

    if body.serialized_position.trim().is_empty() {
        return Err(AppError::BadRequest(
            "serializedPosition cannot be empty".into(),
        ));
    }

    access::require_document_view(&state, body.document_id, user_id).await?;

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO annotations
            (document_id, user_id, annotation_type, serialized_position, content, color)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(body.document_id)
    .bind(user_id)
    .bind(&body.annotation_type)
    .bind(&body.serialized_position)
    .bind(&body.content)
    .bind(&body.color)
    .fetch_one(&state.db)
    .await?;

    let annotation = sqlx::query_as::<_, Annotation>(
        "SELECT id, document_id, annotation_type, serialized_position, content, color, created_at
         FROM annotations WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(annotation)))
}

/// Deletes an annotation, scoped to the requesting user so one reader cannot
/// remove another's highlights.
pub async fn delete(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<StatusCode> {
    let document_id: i64 = sqlx::query_scalar(
        "SELECT document_id FROM annotations WHERE id = ? AND user_id = ?",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    access::require_document_view(&state, document_id, user_id).await?;

    let result = sqlx::query("DELETE FROM annotations WHERE id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}
