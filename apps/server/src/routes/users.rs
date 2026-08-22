use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::current_user::AuthenticatedUser;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UserSummary {
    id: i64,
    username: String,
    is_admin: bool,
    avatar_url: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Invitation {
    github_login: String,
    is_admin: bool,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessList {
    users: Vec<UserSummary>,
    invitations: Vec<Invitation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteRequest {
    github_login: String,
    #[serde(default)]
    is_admin: bool,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/invitations", post(invite))
        .route("/invitations/{login}", delete(remove_invitation))
        .route("/{id}", delete(remove_user))
}

async fn require_admin(state: &AppState, user_id: i64) -> AppResult<()> {
    let is_admin: i64 = sqlx::query_scalar("SELECT is_admin FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
    if is_admin == 0 {
        return Err(AppError::Forbidden("administrator access required".into()));
    }
    Ok(())
}

pub async fn list_access(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
) -> AppResult<Json<AccessList>> {
    require_admin(&state, user_id).await?;
    let users = sqlx::query_as(
        "SELECT id, username, is_admin, avatar_url
         FROM users WHERE github_user_id IS NOT NULL ORDER BY username COLLATE NOCASE",
    )
    .fetch_all(&state.db)
    .await?;
    let invitations = sqlx::query_as(
        "SELECT github_login, is_admin, created_at
         FROM github_invitations ORDER BY github_login COLLATE NOCASE",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(AccessList { users, invitations }))
}

pub async fn invite(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
    Json(body): Json<InviteRequest>,
) -> AppResult<(StatusCode, Json<Invitation>)> {
    require_admin(&state, user_id).await?;
    let login = body.github_login.trim().trim_start_matches('@');
    if login.is_empty()
        || login.len() > 39
        || !login.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(AppError::BadRequest("enter a valid GitHub username".into()));
    }
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE username = ? COLLATE NOCASE AND github_user_id IS NOT NULL",
    )
    .bind(login)
    .fetch_one(&state.db)
    .await?;
    if exists != 0 {
        return Err(AppError::Conflict(
            "that GitHub user already has access".into(),
        ));
    }

    let invitation = sqlx::query_as(
        "INSERT INTO github_invitations (github_login, is_admin, invited_by)
         VALUES (?, ?, ?)
         ON CONFLICT(github_login) DO UPDATE SET is_admin = excluded.is_admin
         RETURNING github_login, is_admin, created_at",
    )
    .bind(login)
    .bind(body.is_admin)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    Ok((StatusCode::CREATED, Json(invitation)))
}

pub async fn remove_invitation(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
    Path(login): Path<String>,
) -> AppResult<StatusCode> {
    require_admin(&state, user_id).await?;
    let result =
        sqlx::query("DELETE FROM github_invitations WHERE github_login = ? COLLATE NOCASE")
            .bind(login)
            .execute(&state.db)
            .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_user(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
    Path(target_id): Path<i64>,
) -> AppResult<StatusCode> {
    require_admin(&state, user_id).await?;
    if user_id == target_id {
        return Err(AppError::BadRequest(
            "you cannot remove your own account".into(),
        ));
    }
    let result = sqlx::query("DELETE FROM users WHERE id = ? AND github_user_id IS NOT NULL")
        .bind(target_id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}
