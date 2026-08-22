use std::sync::Arc;

use sqlx::SqlitePool;

use crate::config::Config;

/// Shared handler state. Cloning is cheap — the pool is internally reference
/// counted and the config sits behind an `Arc`.
#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub config: Arc<Config>,
    pub http: reqwest::Client,
}

impl AppState {
    pub fn new(db: SqlitePool, config: Config) -> Self {
        Self {
            db,
            config: Arc::new(config),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(90))
                .build()
                .expect("valid HTTP client configuration"),
        }
    }
}
