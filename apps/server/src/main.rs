use anyhow::{Context, Result};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

use kintara_server::config::Config;
use kintara_server::state::AppState;
use kintara_server::{auth, db, routes, scanner};

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let config = Config::from_env()?;
    config.ensure_dirs()?;

    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|arg| arg == "recover-owner") {
        return recover_owner(config, &args).await;
    }

    tracing::info!(
        library = %config.library_dir.display(),
        data = %config.data_dir.display(),
        web = %config.web_dir.display(),
        "starting kintara-server {}",
        env!("CARGO_PKG_VERSION")
    );

    let pool = db::connect(&config.database_path()).await?;
    let bind = config.bind;
    let scan_on_start = config.scan_on_start;
    let watch = config.watch;
    let state = AppState::new(pool, config);

    auth::purge_expired_sessions(&state).await?;

    if scan_on_start {
        if let Err(err) = scanner::full_scan(&state).await {
            // A failed scan must not stop the server: the library is still
            // readable from whatever is already indexed.
            tracing::error!(?err, "library scan failed");
        }
    }

    if watch {
        scanner::spawn_watcher(state.clone());
    }

    if auth::needs_owner(&state).await? {
        tracing::warn!(
            "no GitHub owner is linked — the first authorized GitHub sign-in \
             will claim the owner account"
        );
    }

    let app = routes::router(state);

    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .with_context(|| format!("failed to bind {bind}"))?;

    tracing::info!("listening on http://{bind}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;

    Ok(())
}

async fn recover_owner(config: Config, args: &[String]) -> Result<()> {
    let github_id: i64 = args
        .get(2)
        .context("usage: kintara-server recover-owner <github-id> <github-login>")?
        .parse()
        .context("github-id must be the numeric GitHub user id")?;
    let login = args
        .get(3)
        .context("usage: kintara-server recover-owner <github-id> <github-login>")?;
    if login.trim().is_empty() {
        anyhow::bail!("github-login cannot be empty");
    }

    let pool = db::connect(&config.database_path()).await?;
    let target: i64 = match sqlx::query_scalar("SELECT id FROM users WHERE github_user_id = ?")
        .bind(github_id)
        .fetch_optional(&pool)
        .await?
    {
        Some(id) => id,
        None => {
            sqlx::query_scalar("SELECT id FROM users ORDER BY is_admin DESC, id LIMIT 1")
                .fetch_one(&pool)
                .await?
        }
    };

    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE users SET is_admin = 0")
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE users SET username = ?, github_user_id = ?, is_admin = 1 WHERE id = ?")
        .bind(login.trim())
        .bind(github_id)
        .bind(target)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM sessions")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    println!(
        "Kintara owner recovered for GitHub user {} ({github_id}).",
        login.trim()
    );
    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_env("KINTARA_LOG")
        .unwrap_or_else(|_| EnvFilter::new("kintara_server=info,tower_http=info,warn"));

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .init();
}

/// Containers are stopped with SIGTERM, so handling only Ctrl-C would mean
/// every `docker stop` waits out the kill timeout.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl-C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }

    tracing::info!("shutdown signal received");
}
