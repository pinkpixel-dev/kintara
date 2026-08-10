use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// Every fallible handler returns this. Internal detail is logged, never sent
/// to the client — a document server leaks filesystem layout otherwise.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found")]
    NotFound,

    #[error("{0}")]
    BadRequest(String),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, "not found".to_string()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Database(sqlx::Error::RowNotFound) => {
                (StatusCode::NOT_FOUND, "not found".to_string())
            }
            AppError::Database(_) | AppError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal server error".to_string(),
            ),
        };

        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = ?self, "request failed");
        }

        (status, Json(json!({ "error": message }))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
