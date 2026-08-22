//! GitHub identity mapping and Kintara session management.

use base64::Engine;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub const SESSION_DAYS: i64 = 30;
pub const SESSION_COOKIE: &str = "kintara_session";

#[derive(Debug, Clone)]
pub struct GitHubIdentity {
    pub id: i64,
    pub login: String,
    pub avatar_url: Option<String>,
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("operating system randomness unavailable");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub async fn create_session(state: &AppState, user_id: i64) -> AppResult<String> {
    let id = random_token();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, expires_at)
         VALUES (?, ?, datetime('now', ?))",
    )
    .bind(&id)
    .bind(user_id)
    .bind(format!("+{SESSION_DAYS} days"))
    .execute(&state.db)
    .await?;
    Ok(id)
}

pub async fn user_for_session(state: &AppState, session_id: &str) -> AppResult<Option<i64>> {
    Ok(sqlx::query_scalar(
        "SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')",
    )
    .bind(session_id)
    .fetch_optional(&state.db)
    .await?)
}

pub async fn destroy_session(state: &AppState, session_id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM sessions WHERE id = ?")
        .bind(session_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

pub async fn purge_expired_sessions(state: &AppState) -> AppResult<()> {
    sqlx::query("DELETE FROM sessions WHERE expires_at <= datetime('now')")
        .execute(&state.db)
        .await?;
    sqlx::query("DELETE FROM oauth_states WHERE expires_at <= datetime('now')")
        .execute(&state.db)
        .await?;
    Ok(())
}

pub async fn needs_owner(state: &AppState) -> AppResult<bool> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE github_user_id IS NOT NULL")
            .fetch_one(&state.db)
            .await?;
    Ok(count == 0)
}

pub async fn resolve_github_user(state: &AppState, identity: &GitHubIdentity) -> AppResult<i64> {
    if let Some(id) = sqlx::query_scalar("SELECT id FROM users WHERE github_user_id = ?")
        .bind(identity.id)
        .fetch_optional(&state.db)
        .await?
    {
        sqlx::query("UPDATE users SET username = ?, avatar_url = ? WHERE id = ?")
            .bind(&identity.login)
            .bind(&identity.avatar_url)
            .bind(id)
            .execute(&state.db)
            .await?;
        return Ok(id);
    }

    if needs_owner(state).await? {
        let id: i64 = sqlx::query_scalar("SELECT id FROM users ORDER BY id LIMIT 1")
            .fetch_one(&state.db)
            .await?;
        let claimed = sqlx::query(
            "UPDATE users
             SET username = ?, github_user_id = ?, avatar_url = ?, is_admin = 1
             WHERE id = ? AND github_user_id IS NULL",
        )
        .bind(&identity.login)
        .bind(identity.id)
        .bind(&identity.avatar_url)
        .bind(id)
        .execute(&state.db)
        .await?;
        if claimed.rows_affected() == 1 {
            sqlx::query("DELETE FROM sessions")
                .execute(&state.db)
                .await?;
            return Ok(id);
        }
    }

    let invitation: Option<i64> = sqlx::query_scalar(
        "SELECT is_admin FROM github_invitations WHERE github_login = ? COLLATE NOCASE",
    )
    .bind(&identity.login)
    .fetch_optional(&state.db)
    .await?;
    let Some(is_admin) = invitation else {
        return Err(AppError::Unauthorized(
            "this GitHub account has not been invited".into(),
        ));
    };

    let mut tx = state.db.begin().await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO users (username, is_admin, github_user_id, avatar_url)
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(&identity.login)
    .bind(is_admin)
    .bind(identity.id)
    .bind(&identity.avatar_url)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM github_invitations WHERE github_login = ? COLLATE NOCASE")
        .bind(&identity.login)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(id)
}

pub fn session_cookie(id: &str, secure: bool) -> String {
    format!(
        "{SESSION_COOKIE}={id}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
        SESSION_DAYS * 24 * 60 * 60,
        if secure { "; Secure" } else { "" }
    )
}

pub fn clear_cookie(secure: bool) -> String {
    format!(
        "{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{}",
        if secure { "; Secure" } else { "" }
    )
}

pub fn session_from_cookies(header: &str) -> Option<String> {
    header.split(';').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        (name.trim() == SESSION_COOKIE).then(|| value.trim().to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_ids_are_unique_and_long() {
        let a = random_token();
        let b = random_token();
        assert_ne!(a, b);
        assert!(a.len() >= 40);
    }

    #[test]
    fn session_cookie_is_http_only_and_secure_for_https() {
        let secure = session_cookie("abc", true);
        assert!(secure.contains("HttpOnly"));
        assert!(secure.contains("SameSite=Lax"));
        assert!(secure.contains("Secure"));
        assert!(!session_cookie("abc", false).contains("; Secure"));
    }
}
