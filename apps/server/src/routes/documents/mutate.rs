use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::access;
use crate::current_user::CurrentUser;
use crate::error::{AppError, AppResult};
use crate::files::resolve_in_root;
use crate::state::AppState;

/// Editable metadata.
///
/// `Option<Option<T>>` distinguishes the three cases JSON actually has: the
/// field is absent (leave it alone), the field is null (clear it), or the field
/// has a value (set it). A plain `Option<T>` would make clearing a field
/// impossible, which matters for a metadata editor.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDocument {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "crate::models::double_option")]
    pub author: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::models::double_option")]
    pub summary: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::models::double_option")]
    pub keywords: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::models::double_option")]
    pub doi: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::models::double_option")]
    pub isbn: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::models::double_option")]
    pub year: Option<Option<i64>>,
}

pub async fn update(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<UpdateDocument>,
) -> AppResult<StatusCode> {
    access::require_document_editor(&state, id, user_id).await?;
    if let Some(title) = &body.title {
        if title.trim().is_empty() {
            return Err(AppError::BadRequest("title cannot be empty".into()));
        }
    }

    let mut tx = state.db.begin().await?;

    // Written as individual statements rather than a built UPDATE so every
    // column name is a literal. The set is small and fixed.
    if let Some(title) = body.title {
        sqlx::query("UPDATE documents SET title = ? WHERE id = ?")
            .bind(title.trim())
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(author) = body.author {
        sqlx::query("UPDATE documents SET author = ? WHERE id = ?")
            .bind(author)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(summary) = body.summary {
        sqlx::query("UPDATE documents SET summary = ? WHERE id = ?")
            .bind(summary)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(keywords) = body.keywords {
        sqlx::query("UPDATE documents SET keywords = ? WHERE id = ?")
            .bind(keywords)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(doi) = body.doi {
        sqlx::query("UPDATE documents SET doi = ? WHERE id = ?")
            .bind(doi)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(isbn) = body.isbn {
        sqlx::query("UPDATE documents SET isbn = ? WHERE id = ?")
            .bind(isbn)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(year) = body.year {
        sqlx::query("UPDATE documents SET year = ? WHERE id = ?")
            .bind(year)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    let touched = sqlx::query("UPDATE documents SET modified_at = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    if touched.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressBody {
    pub reading_progress: f64,
}

pub async fn set_progress(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<ProgressBody>,
) -> AppResult<StatusCode> {
    if !body.reading_progress.is_finite() || !(0.0..=1.0).contains(&body.reading_progress) {
        return Err(AppError::BadRequest(
            "readingProgress must be between 0 and 1".into(),
        ));
    }

    access::require_document_view(&state, id, user_id).await?;

    // Upsert, because a user who has never opened this document has no row.
    sqlx::query(
        "INSERT INTO user_document_state (user_id, document_id, reading_progress, last_opened_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT (user_id, document_id)
         DO UPDATE SET reading_progress = excluded.reading_progress,
                       last_opened_at   = excluded.last_opened_at",
    )
    .bind(user_id)
    .bind(id)
    .bind(body.reading_progress)
    .execute(&state.db)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBody {
    pub is_favorite: bool,
}

pub async fn set_favorite(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<FavoriteBody>,
) -> AppResult<StatusCode> {
    access::require_document_view(&state, id, user_id).await?;

    sqlx::query(
        "INSERT INTO user_document_state (user_id, document_id, is_favorite)
         VALUES (?, ?, ?)
         ON CONFLICT (user_id, document_id)
         DO UPDATE SET is_favorite = excluded.is_favorite",
    )
    .bind(user_id)
    .bind(id)
    .bind(body.is_favorite)
    .execute(&state.db)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Deletes a document, its file, and its thumbnail.
///
/// The file goes too, deliberately. The scanner re-indexes anything present in
/// the library, so removing only the row would make the document reappear on
/// the next scan and "delete" would look broken. Callers are expected to
/// confirm with the user first.
pub async fn delete(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<StatusCode> {
    access::require_document_owner(&state, id, user_id).await?;
    let row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT relative_path, thumbnail_name FROM documents WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

    let (relative_path, thumbnail_name) = row.ok_or(AppError::NotFound)?;

    // The row goes first. If the unlink fails the library is merely stale,
    // whereas deleting the file and failing to delete the row would leave a
    // permanently broken entry.
    sqlx::query("DELETE FROM documents WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await?;

    if let Ok(path) = resolve_in_root(&state.config.library_dir, &relative_path) {
        if let Err(err) = tokio::fs::remove_file(&path).await {
            tracing::warn!(path = %path.display(), %err, "failed to remove document file");
        }
    }

    if let Some(name) = thumbnail_name {
        if let Ok(path) = resolve_in_root(&state.config.thumbnail_dir(), &name) {
            let _ = tokio::fs::remove_file(&path).await;
        }
    }

    Ok(StatusCode::NO_CONTENT)
}
