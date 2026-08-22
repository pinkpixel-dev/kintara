pub mod ai;
pub mod ai_chat;
pub mod annotations;
pub mod auth;
pub mod collections;
pub mod documents;
pub mod health;
pub mod libraries;
pub mod tags;
pub mod users;

use axum::Router;
use axum::routing::{get, post};
use tower::Layer;
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
        .nest("/auth", auth::router())
        .route("/me", get(auth::me))
        .nest("/ai", ai::router().merge(ai_chat::router()))
        .nest(
            "/documents",
            documents::router(state.config.max_upload_bytes),
        )
        .nest("/libraries", libraries::router())
        .nest("/collections", collections::router())
        .nest("/tags", tags::router())
        .route("/users", get(users::list_access))
        .nest("/users", users::router())
        .route("/annotations", post(annotations::create))
        .route(
            "/annotations/{id}",
            axum::routing::delete(annotations::delete),
        )
        .fallback(api_not_found)
        .with_state(state.clone());

    // The frontend is a single-page app, so any unmatched path that is not a
    // real file has to return index.html and let the client router handle it.
    let index = state.config.web_dir.join("index.html");
    let spa = ServeDir::new(&state.config.web_dir).fallback(ServeFile::new(index));

    // Compression is attached to the static bundle here, and to the JSON
    // document routes inside `documents::router`. It is deliberately never in
    // front of document bytes: PDFs are already compressed, gzip would burn NAS
    // CPU for nothing, and compressing a 206 range response is simply wrong.
    let spa = CompressionLayer::new().layer(spa);

    Router::new()
        .nest("/api", api)
        .fallback_service(spa)
        .layer(TraceLayer::new_for_http())
}
