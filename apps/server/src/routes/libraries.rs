use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub id: i64,
    pub name: String,
    pub theme_color: Option<String>,
    pub icon: Option<String>,
    pub icon_color: Option<String>,
    /// Included so the sidebar can show counts without a request per library.
    pub document_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLibrary {
    pub name: String,
    #[serde(default)]
    pub theme_color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub icon_color: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLibrary {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "crate::models::double_option")]
    pub theme_color: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::models::double_option")]
    pub icon: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::models::double_option")]
    pub icon_color: Option<Option<String>>,
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

pub async fn list(State(state): State<AppState>) -> AppResult<Json<Vec<Library>>> {
    let libraries = sqlx::query_as::<_, Library>(
        "SELECT l.id, l.name, l.theme_color, l.icon, l.icon_color,
                (SELECT COUNT(*) FROM library_documents ld WHERE ld.library_id = l.id)
                    AS document_count
         FROM libraries l
         ORDER BY l.name COLLATE NOCASE ASC",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(libraries))
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateLibrary>,
) -> AppResult<(StatusCode, Json<Library>)> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name cannot be empty".into()));
    }

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO libraries (name, theme_color, icon, icon_color)
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(name)
    .bind(&body.theme_color)
    .bind(&body.icon)
    .bind(&body.icon_color)
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(fetch(&state, id).await?)))
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateLibrary>,
) -> AppResult<Json<Library>> {
    if let Some(name) = &body.name {
        if name.trim().is_empty() {
            return Err(AppError::BadRequest("name cannot be empty".into()));
        }
    }

    let mut tx = state.db.begin().await?;

    if let Some(name) = &body.name {
        sqlx::query("UPDATE libraries SET name = ? WHERE id = ?")
            .bind(name.trim())
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(value) = &body.theme_color {
        sqlx::query("UPDATE libraries SET theme_color = ? WHERE id = ?")
            .bind(value)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(value) = &body.icon {
        sqlx::query("UPDATE libraries SET icon = ? WHERE id = ?")
            .bind(value)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(value) = &body.icon_color {
        sqlx::query("UPDATE libraries SET icon_color = ? WHERE id = ?")
            .bind(value)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

/// Deletes the library and, by cascade, its collections and membership rows.
/// Documents themselves are untouched — a library is a view over them, not a
/// container that owns them.
pub async fn delete(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<StatusCode> {
    let result = sqlx::query("DELETE FROM libraries WHERE id = ?")
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
    sqlx::query("INSERT OR IGNORE INTO library_documents (library_id, document_id) VALUES (?, ?)")
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
    sqlx::query("DELETE FROM library_documents WHERE library_id = ? AND document_id = ?")
        .bind(id)
        .bind(document_id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn fetch(state: &AppState, id: i64) -> AppResult<Library> {
    sqlx::query_as::<_, Library>(
        "SELECT l.id, l.name, l.theme_color, l.icon, l.icon_color,
                (SELECT COUNT(*) FROM library_documents ld WHERE ld.library_id = l.id)
                    AS document_count
         FROM libraries l WHERE l.id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)
}
