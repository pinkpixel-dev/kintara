use axum::extract::{Path, State};
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
pub struct Library {
    pub id: i64,
    pub name: String,
    pub theme_color: Option<String>,
    pub icon: Option<String>,
    pub icon_color: Option<String>,
    pub document_count: i64,
    pub owner_username: String,
    pub access_role: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMember {
    pub user_id: i64,
    pub username: String,
    pub avatar_url: Option<String>,
    pub role: String,
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

#[derive(Debug, Deserialize)]
pub struct ShareLibrary {
    pub username: String,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMember {
    pub role: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", axum::routing::patch(update).delete(delete))
        .route("/{id}/members", get(list_members).post(share))
        .route(
            "/{id}/members/{member_id}",
            axum::routing::patch(update_member).delete(remove_member),
        )
        .route(
            "/{id}/documents/{document_id}",
            post(add_document).delete(remove_document),
        )
}

pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
) -> AppResult<Json<Vec<Library>>> {
    let libraries = sqlx::query_as::<_, Library>(
        "SELECT l.id, l.name, l.theme_color, l.icon, l.icon_color,
                (SELECT COUNT(*) FROM library_documents ld WHERE ld.library_id = l.id)
                    AS document_count,
                owner.username AS owner_username,
                CASE WHEN l.owner_id = ? THEN 'owner' ELSE lm.role END AS access_role
         FROM libraries l
         JOIN users owner ON owner.id = l.owner_id
         LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
         WHERE l.owner_id = ? OR lm.user_id IS NOT NULL
         ORDER BY CASE WHEN l.owner_id = ? THEN 0 ELSE 1 END,
                  l.name COLLATE NOCASE ASC",
    )
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(libraries))
}

pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Json(body): Json<CreateLibrary>,
) -> AppResult<(StatusCode, Json<Library>)> {
    let name = clean_name(&body.name)?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO libraries (owner_id, name, theme_color, icon, icon_color)
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(user_id)
    .bind(name)
    .bind(&body.theme_color)
    .bind(&body.icon)
    .bind(&body.icon_color)
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
    Json(body): Json<UpdateLibrary>,
) -> AppResult<Json<Library>> {
    access::require_library_owner(&state, id, user_id).await?;
    let mut tx = state.db.begin().await?;

    if let Some(name) = &body.name {
        sqlx::query("UPDATE libraries SET name = ? WHERE id = ?")
            .bind(clean_name(name)?)
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
    Ok(Json(fetch(&state, id, user_id).await?))
}

pub async fn delete(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<StatusCode> {
    access::require_library_owner(&state, id, user_id).await?;
    sqlx::query("DELETE FROM libraries WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_document(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path((id, document_id)): Path<(i64, i64)>,
) -> AppResult<StatusCode> {
    access::require_library_editor(&state, id, user_id).await?;
    access::require_document_owner(&state, document_id, user_id).await?;
    sqlx::query("INSERT OR IGNORE INTO library_documents (library_id, document_id) VALUES (?, ?)")
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
    access::require_library_editor(&state, id, user_id).await?;
    sqlx::query("DELETE FROM library_documents WHERE library_id = ? AND document_id = ?")
        .bind(id)
        .bind(document_id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_members(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<Json<Vec<LibraryMember>>> {
    access::require_library_owner(&state, id, user_id).await?;
    let members = sqlx::query_as::<_, LibraryMember>(
        "SELECT u.id AS user_id, u.username, u.avatar_url, lm.role
         FROM library_members lm
         JOIN users u ON u.id = lm.user_id
         WHERE lm.library_id = ?
         ORDER BY u.username COLLATE NOCASE",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(members))
}

pub async fn share(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<ShareLibrary>,
) -> AppResult<(StatusCode, Json<LibraryMember>)> {
    access::require_library_owner(&state, id, user_id).await?;
    validate_role(&body.role)?;
    let username = clean_name(&body.username)?;
    let member_id: i64 = sqlx::query_scalar(
        "SELECT id FROM users WHERE username = ? COLLATE NOCASE AND github_user_id IS NOT NULL",
    )
    .bind(username)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::BadRequest("that user must sign in to Kintara first".into()))?;
    if member_id == user_id {
        return Err(AppError::BadRequest(
            "the library owner already has full access".into(),
        ));
    }

    sqlx::query(
        "INSERT INTO library_members (library_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT(library_id, user_id) DO UPDATE SET role = excluded.role",
    )
    .bind(id)
    .bind(member_id)
    .bind(&body.role)
    .execute(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(fetch_member(&state, id, member_id).await?),
    ))
}

pub async fn update_member(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path((id, member_id)): Path<(i64, i64)>,
    Json(body): Json<UpdateMember>,
) -> AppResult<Json<LibraryMember>> {
    access::require_library_owner(&state, id, user_id).await?;
    validate_role(&body.role)?;
    let result = sqlx::query(
        "UPDATE library_members SET role = ? WHERE library_id = ? AND user_id = ?",
    )
    .bind(&body.role)
    .bind(id)
    .bind(member_id)
    .execute(&state.db)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(fetch_member(&state, id, member_id).await?))
}

pub async fn remove_member(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path((id, member_id)): Path<(i64, i64)>,
) -> AppResult<StatusCode> {
    access::require_library_owner(&state, id, user_id).await?;
    let result = sqlx::query(
        "DELETE FROM library_members WHERE library_id = ? AND user_id = ?",
    )
    .bind(id)
    .bind(member_id)
    .execute(&state.db)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn fetch(state: &AppState, id: i64, user_id: i64) -> AppResult<Library> {
    sqlx::query_as::<_, Library>(
        "SELECT l.id, l.name, l.theme_color, l.icon, l.icon_color,
                (SELECT COUNT(*) FROM library_documents ld WHERE ld.library_id = l.id)
                    AS document_count,
                owner.username AS owner_username,
                CASE WHEN l.owner_id = ? THEN 'owner' ELSE lm.role END AS access_role
         FROM libraries l
         JOIN users owner ON owner.id = l.owner_id
         LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
         WHERE l.id = ? AND (l.owner_id = ? OR lm.user_id IS NOT NULL)",
    )
    .bind(user_id)
    .bind(user_id)
    .bind(id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)
}

async fn fetch_member(state: &AppState, library_id: i64, user_id: i64) -> AppResult<LibraryMember> {
    sqlx::query_as(
        "SELECT u.id AS user_id, u.username, u.avatar_url, lm.role
         FROM library_members lm JOIN users u ON u.id = lm.user_id
         WHERE lm.library_id = ? AND lm.user_id = ?",
    )
    .bind(library_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)
}

fn clean_name(value: &str) -> AppResult<&str> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::BadRequest("name cannot be empty".into()));
    }
    Ok(value)
}

fn validate_role(role: &str) -> AppResult<()> {
    if !matches!(role, "viewer" | "editor") {
        return Err(AppError::BadRequest(
            "role must be 'viewer' or 'editor'".into(),
        ));
    }
    Ok(())
}
