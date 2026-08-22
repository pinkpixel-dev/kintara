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
/// Resolved only from a valid Kintara session. First-run setup uses the public
/// auth-status and GitHub callback routes, so the document API never needs an
/// anonymous owner fallback.
#[derive(Debug, Clone, Copy)]
pub struct CurrentUser(pub i64);

/// A real signed-in user used to make the stricter requirement explicit on
/// paid AI calls and account administration routes.
#[derive(Debug, Clone, Copy)]
pub struct AuthenticatedUser(pub i64);

impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let session = parts
            .headers
            .get(axum::http::header::COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(auth::session_from_cookies)
            .ok_or_else(|| AppError::Unauthorized("sign in to continue".into()))?;
        let user_id = auth::user_for_session(state, &session)
            .await?
            .ok_or_else(|| AppError::Unauthorized("sign in to continue".into()))?;
        Ok(Self(user_id))
    }
}

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
            .and_then(auth::session_from_cookies)
            .ok_or_else(|| AppError::Unauthorized("sign in to continue".into()))?;
        let user_id = auth::user_for_session(state, &session)
            .await?
            .ok_or_else(|| AppError::Unauthorized("sign in to continue".into()))?;
        Ok(CurrentUser(user_id))
    }
}
