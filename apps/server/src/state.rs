use std::sync::Arc;

use sqlx::SqlitePool;

use crate::config::Config;

/// Shared handler state. Cloning is cheap — the pool is internally reference
/// counted and the config sits behind an `Arc`.
#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub config: Arc<Config>,
}

impl AppState {
    pub fn new(db: SqlitePool, config: Config) -> Self {
        Self {
            db,
            config: Arc::new(config),
        }
    }
}
