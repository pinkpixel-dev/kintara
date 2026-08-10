use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

use anyhow::{Context, Result};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;

/// Opens the database, applying the pragmas that matter for a multi-reader
/// server, then runs any pending migrations.
///
/// WAL is what makes concurrent reads viable while a write is in flight; the
/// busy timeout covers the brief windows where it is not.
pub async fn connect(database_path: &Path) -> Result<SqlitePool> {
    let url = format!("sqlite://{}", database_path.display());

    let options = SqliteConnectOptions::from_str(&url)
        .with_context(|| format!("invalid database path {}", database_path.display()))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(10));

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(options)
        .await
        .context("failed to open the Kintara database")?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .context("failed to apply database migrations")?;

    Ok(pool)
}
