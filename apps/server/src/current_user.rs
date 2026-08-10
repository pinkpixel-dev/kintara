use axum::extract::FromRequestParts;
use axum::http::request::Parts;

use crate::auth;
use crate::error::AppError;
use crate::state::AppState;

/// The user a request acts as.
///
/// Resolved from the session cookie. Handlers were written against this
/// extractor from the start, so adding real authentication changed only this
/// function rather than every route.
///
/// While the install has no password set, this falls back to the seeded owner
/// account: the library is reachable on first run so the setup screen and the
/// scanner both work, and the moment a password exists the fallback stops.
#[derive(Debug, Clone, Copy)]
pub struct CurrentUser(pub i64);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let session = parts
            .headers
            .get(axum::http::header::COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(auth::session_from_cookies);

        if let Some(session) = session {
            if let Some(user_id) = auth::user_for_session(state, &session).await? {
                return Ok(CurrentUser(user_id));
            }
        }

        if auth::needs_setup(state).await? {
            let id: i64 = sqlx::query_scalar("SELECT id FROM users ORDER BY id LIMIT 1")
                .fetch_optional(&state.db)
                .await?
                .ok_or_else(|| {
                    AppError::Internal(anyhow::anyhow!(
                        "no users exist; migration 0002 should have seeded one"
                    ))
                })?;
            return Ok(CurrentUser(id));
        }

        Err(AppError::Unauthorized("sign in to continue".into()))
    }
}
