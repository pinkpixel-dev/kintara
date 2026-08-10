//! Password hashing and session management.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use base64::Engine;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// How long a session stays valid. Long, because this is a reading app people
/// come back to, and logging out is explicit.
pub const SESSION_DAYS: i64 = 30;

pub const SESSION_COOKIE: &str = "kintara_session";

pub fn hash_password(password: &str) -> AppResult<String> {
    // OsRng comes from the rand_core that argon2 itself uses; pulling in a
    // separate rand crate would mean two incompatible rand_core versions.
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| AppError::Internal(anyhow::anyhow!("failed to hash password: {err}")))
}

/// Verifies a password against a stored hash.
///
/// An empty stored hash — the state a freshly seeded install is in — always
/// fails, so the seeded account cannot be logged into before a password is set.
pub fn verify_password(password: &str, stored_hash: &str) -> bool {
    if stored_hash.is_empty() {
        return false;
    }

    let Ok(parsed) = PasswordHash::new(stored_hash) else {
        return false;
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// 256 bits of randomness, URL-safe. Long enough that guessing is not a threat.
pub fn new_session_id() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub async fn create_session(state: &AppState, user_id: i64) -> AppResult<String> {
    let id = new_session_id();

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

/// Resolves a session id to a user, treating expired sessions as absent.
pub async fn user_for_session(state: &AppState, session_id: &str) -> AppResult<Option<i64>> {
    let user_id: Option<i64> = sqlx::query_scalar(
        "SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')",
    )
    .bind(session_id)
    .fetch_optional(&state.db)
    .await?;

    Ok(user_id)
}

pub async fn destroy_session(state: &AppState, session_id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM sessions WHERE id = ?")
        .bind(session_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

/// Drops expired rows. Called at startup; the expiry check above is what
/// actually enforces validity, so this is only housekeeping.
pub async fn purge_expired_sessions(state: &AppState) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM sessions WHERE expires_at <= datetime('now')")
        .execute(&state.db)
        .await?;

    if result.rows_affected() > 0 {
        tracing::info!(count = result.rows_affected(), "purged expired sessions");
    }
    Ok(())
}

/// True when no account has a usable password yet, which puts the app into
/// first-run setup rather than showing a login form nobody can pass.
pub async fn needs_setup(state: &AppState) -> AppResult<bool> {
    let with_password: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE password_hash != ''")
            .fetch_one(&state.db)
            .await?;

    Ok(with_password == 0)
}

/// Builds the Set-Cookie value for a session.
///
/// HttpOnly keeps it away from scripts, SameSite=Lax blocks cross-site use
/// while still surviving a normal link click. Secure is deliberately not set:
/// most NAS installs are reached over plain HTTP on a LAN, and setting it would
/// make the cookie silently never arrive.
pub fn session_cookie(id: &str) -> String {
    format!(
        "{SESSION_COOKIE}={id}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
        SESSION_DAYS * 24 * 60 * 60
    )
}

pub fn clear_cookie() -> String {
    format!("{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
}

/// Pulls the session id out of a Cookie header.
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
    fn a_password_verifies_against_its_own_hash_and_nothing_else() {
        let hash = hash_password("correct horse battery staple").unwrap();
        assert!(verify_password("correct horse battery staple", &hash));
        assert!(!verify_password("wrong", &hash));
    }

    #[test]
    fn the_seeded_empty_hash_can_never_be_logged_into() {
        // Migration 0002 seeds an empty hash on purpose; nothing must match it.
        assert!(!verify_password("", ""));
        assert!(!verify_password("anything", ""));
    }

    #[test]
    fn a_malformed_stored_hash_is_rejected_rather_than_panicking() {
        assert!(!verify_password("password", "not-a-real-hash"));
    }

    #[test]
    fn session_ids_are_unique_and_long() {
        let a = new_session_id();
        let b = new_session_id();
        assert_ne!(a, b);
        assert!(a.len() >= 40, "session id too short: {a}");
    }

    #[test]
    fn the_session_cookie_is_parsed_out_of_a_full_cookie_header() {
        assert_eq!(
            session_from_cookies("theme=dark; kintara_session=abc123; other=1").as_deref(),
            Some("abc123")
        );
        assert_eq!(session_from_cookies("theme=dark"), None);
    }

    #[test]
    fn the_session_cookie_is_not_reachable_from_scripts() {
        let cookie = session_cookie("abc");
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Lax"));
    }
}
