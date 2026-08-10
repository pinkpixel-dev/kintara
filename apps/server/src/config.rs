use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result};

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
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let library_dir = path_var("KINTARA_LIBRARY_DIR", "./data/library");
        let data_dir = path_var("KINTARA_DATA_DIR", "./data");
        let web_dir = path_var("KINTARA_WEB_DIR", "../web/dist");

        let bind_raw =
            std::env::var("KINTARA_BIND").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
        let bind = bind_raw
            .parse::<SocketAddr>()
            .with_context(|| format!("KINTARA_BIND is not a valid address: {bind_raw}"))?;

        Ok(Self {
            library_dir,
            data_dir,
            web_dir,
            bind,
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

fn path_var(key: &str, default: &str) -> PathBuf {
    std::env::var(key)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(default))
}
