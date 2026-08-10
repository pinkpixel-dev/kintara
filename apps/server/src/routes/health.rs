use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::error::AppResult;
use crate::state::AppState;

#[derive(Serialize)]
pub struct Health {
    status: &'static str,
    version: &'static str,
    /// Number of documents currently indexed. Doubles as proof the database is
    /// reachable, which is what makes this useful as a container healthcheck.
    documents: i64,
}

pub async fn health(State(state): State<AppState>) -> AppResult<Json<Health>> {
    let documents: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM documents")
        .fetch_one(&state.db)
        .await?;

    Ok(Json(Health {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        documents,
    }))
}
