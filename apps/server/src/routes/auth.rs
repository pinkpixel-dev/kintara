use axum::extract::State;
use axum::http::header::{HeaderMap, SET_COOKIE};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::auth;
use crate::current_user::CurrentUser;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub username: String,
    pub is_admin: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// True until a password has been set, which puts the client into setup.
    pub needs_setup: bool,
    pub authenticated: bool,
    pub user: Option<Session>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/status", get(status))
        .route("/setup", post(setup))
        .route("/login", post(login))
        .route("/logout", post(logout))
}

/// Unauthenticated: the login screen needs to know which form to show.
pub async fn status(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Json<AuthStatus>> {
    let needs_setup = auth::needs_setup(&state).await?;

    let user = match session_user(&state, &headers).await? {
        Some(id) => sqlx::query_as::<_, (String, i64)>(
            "SELECT username, is_admin FROM users WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .map(|(username, is_admin)| Session {
            username,
            is_admin: is_admin != 0,
        }),
        None => None,
    };

    Ok(Json(AuthStatus {
        needs_setup,
        authenticated: user.is_some(),
        user,
    }))
}

/// First-run: names the owner account and gives it a password.
///
/// Only works while no account has a password, so it cannot be used to take
/// over an install that is already set up.
pub async fn setup(
    State(state): State<AppState>,
    Json(body): Json<Credentials>,
) -> AppResult<Response> {
    if !auth::needs_setup(&state).await? {
        return Err(AppError::Conflict("this install is already set up".into()));
    }

    let username = body.username.trim();
    if username.is_empty() {
        return Err(AppError::BadRequest("username cannot be empty".into()));
    }
    if body.password.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }

    let hash = auth::hash_password(&body.password)?;

    // Reuse the seeded local row so any documents already indexed keep their
    // reading state, rather than creating a second user beside it.
    let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM users ORDER BY id LIMIT 1")
        .fetch_optional(&state.db)
        .await?;

    let user_id = match existing {
        Some(id) => {
            sqlx::query("UPDATE users SET username = ?, password_hash = ?, is_admin = 1 WHERE id = ?")
                .bind(username)
                .bind(&hash)
                .bind(id)
                .execute(&state.db)
                .await?;
            id
        }
        None => {
            sqlx::query_scalar(
                "INSERT INTO users (username, password_hash, is_admin)
                 VALUES (?, ?, 1) RETURNING id",
            )
            .bind(username)
            .bind(&hash)
            .fetch_one(&state.db)
            .await?
        }
    };

    let session = auth::create_session(&state, user_id).await?;
    Ok(with_session_cookie(StatusCode::NO_CONTENT, &session))
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<Credentials>,
) -> AppResult<Response> {
    let row: Option<(i64, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE username = ?")
            .bind(body.username.trim())
            .fetch_optional(&state.db)
            .await?;

    // Same message and same work either way, so the response does not reveal
    // whether the username exists.
    let valid = match &row {
        Some((_, hash)) => auth::verify_password(&body.password, hash),
        None => {
            auth::verify_password(&body.password, "");
            false
        }
    };

    if !valid {
        return Err(AppError::Unauthorized("invalid username or password".into()));
    }

    let session = auth::create_session(&state, row.expect("checked above").0).await?;
    Ok(with_session_cookie(StatusCode::NO_CONTENT, &session))
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Response> {
    if let Some(id) = session_id(&headers) {
        auth::destroy_session(&state, &id).await?;
    }

    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        auth::clear_cookie().parse().expect("valid cookie"),
    );
    Ok(response)
}

/// Confirms the caller is signed in. Cheap enough for the client to poll.
pub async fn me(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
) -> AppResult<Json<Session>> {
    let (username, is_admin): (String, i64) =
        sqlx::query_as("SELECT username, is_admin FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_one(&state.db)
            .await?;

    Ok(Json(Session {
        username,
        is_admin: is_admin != 0,
    }))
}

fn with_session_cookie(status: StatusCode, session: &str) -> Response {
    let mut response = status.into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        auth::session_cookie(session).parse().expect("valid cookie"),
    );
    response
}

pub fn session_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(auth::session_from_cookies)
}

async fn session_user(state: &AppState, headers: &HeaderMap) -> AppResult<Option<i64>> {
    match session_id(headers) {
        Some(id) => auth::user_for_session(state, &id).await,
        None => Ok(None),
    }
}
