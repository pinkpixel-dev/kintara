use axum::extract::FromRequestParts;
use axum::http::request::Parts;

use crate::error::AppError;
use crate::state::AppState;

/// The user a request acts as.
///
/// Reading progress, favourites, and annotations are all keyed by user, so
/// handlers need one before sessions exist. Until then this resolves to the
/// install's owner — the `local` user seeded by migration 0002.
///
/// When session auth lands, only the body of `from_request_parts` changes;
/// handlers already take this extractor and are already user-scoped, so there
/// is no second code path to write.
#[derive(Debug, Clone, Copy)]
pub struct CurrentUser(pub i64);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        _parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let id: i64 = sqlx::query_scalar("SELECT id FROM users ORDER BY id LIMIT 1")
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| {
                AppError::Internal(anyhow::anyhow!(
                    "no users exist; migration 0002 should have seeded one"
                ))
            })?;

        Ok(CurrentUser(id))
    }
}
