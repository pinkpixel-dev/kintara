use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::http::header::{HeaderMap, SET_COOKIE};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::auth::{self, GitHubIdentity};
use crate::current_user::CurrentUser;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const OAUTH_STATE_COOKIE: &str = "kintara_oauth_state";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub username: String,
    pub is_admin: bool,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub needs_owner: bool,
    pub oauth_configured: bool,
    pub authenticated: bool,
    pub user: Option<Session>,
}

#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubUserResponse {
    id: i64,
    login: String,
    avatar_url: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/status", get(status))
        .route("/github/start", get(github_start))
        .route("/github/callback", get(github_callback))
        .route("/logout", post(logout))
}

pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AuthStatus>> {
    let user = match session_user(&state, &headers).await? {
        Some(id) => sqlx::query_as::<_, (String, i64, Option<String>)>(
            "SELECT username, is_admin, avatar_url FROM users WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .map(|(username, is_admin, avatar_url)| Session {
            username,
            is_admin: is_admin != 0,
            avatar_url,
        }),
        None => None,
    };

    Ok(Json(AuthStatus {
        needs_owner: auth::needs_owner(&state).await?,
        oauth_configured: state.config.github_oauth.is_some(),
        authenticated: user.is_some(),
        user,
    }))
}

pub async fn github_start(State(state): State<AppState>) -> AppResult<Response> {
    let config = state.config.github_oauth.as_ref().ok_or_else(|| {
        AppError::Unavailable("GitHub login has not been configured by the operator".into())
    })?;

    let state_token = auth::random_token();
    let verifier = auth::random_token();
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(Sha256::digest(verifier.as_bytes()));

    sqlx::query(
        "INSERT INTO oauth_states (state, code_verifier, expires_at)
         VALUES (?, ?, datetime('now', '+10 minutes'))",
    )
    .bind(&state_token)
    .bind(&verifier)
    .execute(&state.db)
    .await?;

    let callback = format!("{}/api/auth/github/callback", config.public_url);
    let mut url =
        url::Url::parse("https://github.com/login/oauth/authorize").expect("static GitHub URL");
    url.query_pairs_mut()
        .append_pair("client_id", &config.client_id)
        .append_pair("redirect_uri", &callback)
        .append_pair("state", &state_token)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("allow_signup", "false");
    let secure = config.public_url.starts_with("https://");
    let mut response = Redirect::temporary(url.as_str()).into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        oauth_state_cookie(&state_token, secure)
            .parse()
            .expect("valid cookie"),
    );
    Ok(response)
}

pub async fn github_callback(
    State(state): State<AppState>,
    Query(query): Query<CallbackQuery>,
    headers: HeaderMap,
) -> AppResult<Response> {
    if query.error.is_some() {
        return Err(AppError::Unauthorized(
            "GitHub sign-in was cancelled or denied".into(),
        ));
    }
    let code = query
        .code
        .ok_or_else(|| AppError::BadRequest("missing GitHub authorization code".into()))?;
    let state_token = query
        .state
        .ok_or_else(|| AppError::BadRequest("missing OAuth state".into()))?;
    if cookie_value(&headers, OAUTH_STATE_COOKIE).as_deref() != Some(state_token.as_str()) {
        return Err(AppError::Unauthorized(
            "OAuth state does not match this browser".into(),
        ));
    }
    let verifier: String = sqlx::query_scalar(
        "DELETE FROM oauth_states
         WHERE state = ? AND expires_at > datetime('now')
         RETURNING code_verifier",
    )
    .bind(&state_token)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Unauthorized("OAuth state is invalid or expired".into()))?;

    let config = state.config.github_oauth.as_ref().ok_or_else(|| {
        AppError::Unavailable("GitHub login has not been configured by the operator".into())
    })?;
    let callback = format!("{}/api/auth/github/callback", config.public_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|err| AppError::Internal(err.into()))?;
    let token: TokenResponse = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", config.client_id.as_str()),
            ("client_secret", config.client_secret.as_str()),
            ("code", code.as_str()),
            ("redirect_uri", callback.as_str()),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|err| AppError::Internal(anyhow::anyhow!("GitHub token exchange failed: {err}")))?
        .error_for_status()
        .map_err(|err| AppError::Internal(anyhow::anyhow!("GitHub token exchange failed: {err}")))?
        .json()
        .await
        .map_err(|err| {
            AppError::Internal(anyhow::anyhow!("invalid GitHub token response: {err}"))
        })?;
    let access_token = token.access_token.ok_or_else(|| {
        AppError::Unauthorized(if token.error.is_some() {
            "GitHub did not authorize this sign-in".into()
        } else {
            "GitHub returned no access token".into()
        })
    })?;

    let github_user: GitHubUserResponse = client
        .get("https://api.github.com/user")
        .bearer_auth(&access_token)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Kintara")
        .send()
        .await
        .map_err(|err| {
            AppError::Internal(anyhow::anyhow!("GitHub identity request failed: {err}"))
        })?
        .error_for_status()
        .map_err(|err| {
            AppError::Internal(anyhow::anyhow!("GitHub identity request failed: {err}"))
        })?
        .json()
        .await
        .map_err(|err| {
            AppError::Internal(anyhow::anyhow!("invalid GitHub identity response: {err}"))
        })?;

    let user_id = auth::resolve_github_user(
        &state,
        &GitHubIdentity {
            id: github_user.id,
            login: github_user.login,
            avatar_url: github_user.avatar_url,
        },
    )
    .await?;
    let session = auth::create_session(&state, user_id).await?;
    let secure = config.public_url.starts_with("https://");

    let mut response = Redirect::to("/").into_response();
    response.headers_mut().append(
        SET_COOKIE,
        auth::session_cookie(&session, secure)
            .parse()
            .expect("valid cookie"),
    );
    response.headers_mut().append(
        SET_COOKIE,
        oauth_state_cookie("", secure)
            .parse()
            .expect("valid cookie"),
    );
    Ok(response)
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Response> {
    if let Some(id) = session_id(&headers) {
        auth::destroy_session(&state, &id).await?;
    }
    let secure = state
        .config
        .github_oauth
        .as_ref()
        .is_some_and(|config| config.public_url.starts_with("https://"));
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        auth::clear_cookie(secure).parse().expect("valid cookie"),
    );
    Ok(response)
}

pub async fn me(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
) -> AppResult<Json<Session>> {
    let (username, is_admin, avatar_url): (String, i64, Option<String>) =
        sqlx::query_as("SELECT username, is_admin, avatar_url FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_one(&state.db)
            .await?;
    Ok(Json(Session {
        username,
        is_admin: is_admin != 0,
        avatar_url,
    }))
}

fn session_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(auth::session_from_cookies)
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(axum::http::header::COOKIE)
        .and_then(|value| value.to_str().ok())?
        .split(';')
        .find_map(|pair| {
            let (candidate, value) = pair.trim().split_once('=')?;
            (candidate == name).then(|| value.to_string())
        })
}

fn oauth_state_cookie(value: &str, secure: bool) -> String {
    format!(
        "{OAUTH_STATE_COOKIE}={value}; Path=/api/auth/github/callback; HttpOnly; SameSite=Lax; Max-Age={}{}",
        if value.is_empty() { 0 } else { 600 },
        if secure { "; Secure" } else { "" }
    )
}

async fn session_user(state: &AppState, headers: &HeaderMap) -> AppResult<Option<i64>> {
    match session_id(headers) {
        Some(id) => auth::user_for_session(state, &id).await,
        None => Ok(None),
    }
}
