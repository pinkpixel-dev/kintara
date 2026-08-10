pub mod health;

use axum::routing::get;
use axum::Router;
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::error::AppError;
use crate::state::AppState;

/// Unmatched paths under `/api` must 404 as JSON. Without this they fall
/// through to the SPA fallback below and return index.html with a 200, which
/// turns every client fetch bug into a confusing HTML-parsed-as-JSON error.
async fn api_not_found() -> AppError {
    AppError::NotFound
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health::health))
        .fallback(api_not_found)
        .with_state(state.clone());

    // The frontend is a single-page app, so any unmatched path that is not a
    // real file has to return index.html and let the client router handle it.
    let index = state.config.web_dir.join("index.html");
    let spa = ServeDir::new(&state.config.web_dir).fallback(ServeFile::new(index));

    Router::new()
        .nest("/api", api)
        // Compression is applied here rather than globally on purpose: document
        // streaming lands outside this layer, and gzipping PDFs burns NAS CPU
        // for almost no gain.
        .layer(CompressionLayer::new())
        .fallback_service(spa)
        .layer(TraceLayer::new_for_http())
}
