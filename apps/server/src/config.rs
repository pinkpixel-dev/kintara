use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct GitHubOAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    pub public_url: String,
}

/// Runtime configuration, read entirely from the environment.
///
/// Defaults are relative paths so `cargo run` works from the crate directory
/// without setup. The container image overrides all of them with absolute
/// paths (`/library`, `/data`, `/app/web`).
#[derive(Debug, Clone)]
pub struct Config {
    /// Root of the document library. Every `documents.relative_path` in the
    /// database is resolved against this, which is what lets the volume move.
    pub library_dir: PathBuf,
    /// Holds the SQLite database and generated thumbnails. Kept separate from
    /// `library_dir` because that one is typically also a network share, and
    /// SQLite over SMB/NFS corrupts.
    pub data_dir: PathBuf,
    /// Directory containing the built frontend (`apps/web/dist`).
    pub web_dir: PathBuf,
    pub bind: SocketAddr,
    /// Sweep the library at startup. Files arrive over SMB while the server is
    /// down, so this is on by default.
    pub scan_on_start: bool,
    /// Watch the library for changes while running. Worth turning off on a
    /// share where inotify watches are scarce or the filesystem does not
    /// report events at all.
    pub watch: bool,
    /// Largest upload accepted, in bytes. Scanned books run to hundreds of
    /// megabytes, and axum's 2 MB default rejects almost any real PDF.
    pub max_upload_bytes: usize,
    /// OAuth credentials stay on the server; the frontend receives only a
    /// relative URL that begins the authorization flow.
    pub github_oauth: Option<GitHubOAuthConfig>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let library_dir = path_var("KINTARA_LIBRARY_DIR", "./data/library");
        let data_dir = path_var("KINTARA_DATA_DIR", "./data");
        let web_dir = path_var("KINTARA_WEB_DIR", "../web/dist");

        let bind_raw = std::env::var("KINTARA_BIND").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
        let bind = bind_raw
            .parse::<SocketAddr>()
            .with_context(|| format!("KINTARA_BIND is not a valid address: {bind_raw}"))?;

        let github_oauth = github_oauth_from_env()?;

        Ok(Self {
            library_dir,
            data_dir,
            web_dir,
            bind,
            scan_on_start: bool_var("KINTARA_SCAN_ON_START", true),
            watch: bool_var("KINTARA_WATCH", true),
            max_upload_bytes: std::env::var("KINTARA_MAX_UPLOAD_MB")
                .ok()
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(1024)
                .saturating_mul(1024 * 1024),
            github_oauth,
        })
    }

    /// Creates the directories the server writes to. The library directory is
    /// included because a first run against an empty volume is normal.
    pub fn ensure_dirs(&self) -> Result<()> {
        for dir in [&self.library_dir, &self.data_dir, &self.thumbnail_dir()] {
            std::fs::create_dir_all(dir)
                .with_context(|| format!("failed to create directory {}", dir.display()))?;
        }
        Ok(())
    }

    pub fn thumbnail_dir(&self) -> PathBuf {
        self.data_dir.join("thumbnails")
    }

    pub fn database_path(&self) -> PathBuf {
        self.data_dir.join("kintara.db")
    }
}

fn github_oauth_from_env() -> Result<Option<GitHubOAuthConfig>> {
    let client_id = std::env::var("KINTARA_GITHUB_CLIENT_ID").ok();
    let client_secret = std::env::var("KINTARA_GITHUB_CLIENT_SECRET").ok();
    let public_url = std::env::var("KINTARA_PUBLIC_URL").ok();

    if client_id.is_none() && client_secret.is_none() && public_url.is_none() {
        return Ok(None);
    }

    let missing = [
        ("KINTARA_GITHUB_CLIENT_ID", client_id.is_none()),
        ("KINTARA_GITHUB_CLIENT_SECRET", client_secret.is_none()),
        ("KINTARA_PUBLIC_URL", public_url.is_none()),
    ]
    .into_iter()
    .filter_map(|(name, absent)| absent.then_some(name))
    .collect::<Vec<_>>();
    if !missing.is_empty() {
        anyhow::bail!(
            "GitHub login configuration is incomplete; missing {}",
            missing.join(", ")
        );
    }

    let public_url = public_url.unwrap().trim_end_matches('/').to_string();
    let parsed = url::Url::parse(&public_url)
        .with_context(|| "KINTARA_PUBLIC_URL must be an absolute URL")?;
    if !matches!(parsed.scheme(), "http" | "https") {
        anyhow::bail!("KINTARA_PUBLIC_URL must use http or https");
    }

    Ok(Some(GitHubOAuthConfig {
        client_id: client_id.unwrap(),
        client_secret: client_secret.unwrap(),
        public_url,
    }))
}

/// Accepts the spellings people actually type in a compose file.
fn bool_var(key: &str, default: bool) -> bool {
    match std::env::var(key) {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => default,
    }
}

fn path_var(key: &str, default: &str) -> PathBuf {
    std::env::var(key)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(default))
}
