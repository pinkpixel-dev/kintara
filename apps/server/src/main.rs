use anyhow::{Context, Result};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use kintara_server::config::Config;
use kintara_server::state::AppState;
use kintara_server::{db, routes};

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let config = Config::from_env()?;
    config.ensure_dirs()?;

    tracing::info!(
        library = %config.library_dir.display(),
        data = %config.data_dir.display(),
        web = %config.web_dir.display(),
        "starting kintara-server {}",
        env!("CARGO_PKG_VERSION")
    );

    let pool = db::connect(&config.database_path()).await?;
    let bind = config.bind;
    let app = routes::router(AppState::new(pool, config));

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
