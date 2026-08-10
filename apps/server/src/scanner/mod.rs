pub mod index;

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use tokio::sync::mpsc;
use walkdir::WalkDir;

use crate::error::AppResult;
use crate::state::AppState;

pub use index::{is_indexable, Outcome};

/// Walks the library and brings the database in line with what is on disk.
///
/// Runs at startup because files arrive over SMB while the server is down, and
/// because the watcher only ever reports changes it was running for.
pub async fn full_scan(state: &AppState) -> AppResult<()> {
    let root = state.config.library_dir.clone();
    tracing::info!(root = %root.display(), "scanning library");

    let files: Vec<PathBuf> = tokio::task::spawn_blocking(move || {
        WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| entry.into_path())
            .filter(|path| index::is_indexable(path))
            .collect()
    })
    .await
    .map_err(|err| crate::error::AppError::Internal(err.into()))?;

    let mut seen: HashSet<String> = HashSet::new();
    let mut added = 0usize;
    let mut updated = 0usize;

    for path in &files {
        if let Some(relative) = index::relative_to_root(&state.config.library_dir, path) {
            seen.insert(relative);
        }
        match index::index_file(state, path).await {
            Ok(Outcome::Added(_)) => added += 1,
            Ok(Outcome::Updated(_)) => updated += 1,
            Ok(Outcome::Skipped) => {}
            Err(err) => tracing::warn!(path = %path.display(), ?err, "failed to index"),
        }
    }

    // Anything indexed but no longer on disk was deleted while the server was
    // down, or straight off the share.
    let known: Vec<String> = sqlx::query_scalar("SELECT relative_path FROM documents")
        .fetch_all(&state.db)
        .await?;

    let mut removed = 0usize;
    for relative in known {
        if !seen.contains(&relative) {
            if index::forget_path(state, &relative).await? {
                removed += 1;
            }
        }
    }

    tracing::info!(
        scanned = files.len(),
        added,
        updated,
        removed,
        "library scan complete"
    );
    Ok(())
}

/// Watches the library for changes and keeps the index current.
///
/// Events are debounced: a single copy over SMB produces a burst of writes, and
/// reacting to each one would hash and re-thumbnail a file that is still being
/// written. The watcher runs for the life of the process.
pub fn spawn_watcher(state: AppState) {
    let root = state.config.library_dir.clone();

    tokio::spawn(async move {
        let (tx, mut rx) = mpsc::unbounded_channel::<notify::Event>();

        let mut watcher = match notify::recommended_watcher(move |result| {
            if let Ok(event) = result {
                // A closed receiver just means shutdown.
                let _ = tx.send(event);
            }
        }) {
            Ok(watcher) => watcher,
            Err(err) => {
                tracing::warn!(%err, "could not start the library watcher; \
                    new files will only appear after a restart");
                return;
            }
        };

        if let Err(err) = watcher.watch(&root, RecursiveMode::Recursive) {
            tracing::warn!(%err, root = %root.display(), "could not watch the library");
            return;
        }

        tracing::info!(root = %root.display(), "watching library for changes");

        let mut pending: HashSet<PathBuf> = HashSet::new();

        loop {
            // Collect events until the share goes quiet, then act once.
            let event = match rx.recv().await {
                Some(event) => event,
                None => break,
            };
            pending.extend(event.paths);

            loop {
                match tokio::time::timeout(Duration::from_millis(1500), rx.recv()).await {
                    Ok(Some(event)) => pending.extend(event.paths),
                    Ok(None) => break,
                    Err(_) => break, // quiet period reached
                }
            }

            for path in pending.drain() {
                if !index::is_indexable(&path) {
                    continue;
                }

                if path.exists() {
                    if let Err(err) = index::index_file(&state, &path).await {
                        tracing::warn!(path = %path.display(), ?err, "failed to index");
                    }
                } else if let Some(relative) =
                    index::relative_to_root(&state.config.library_dir, &path)
                {
                    if let Err(err) = index::forget_path(&state, &relative).await {
                        tracing::warn!(%relative, ?err, "failed to remove");
                    }
                }
            }
        }

        // Dropping the watcher here rather than earlier is what keeps it alive
        // for the life of the task.
        drop(watcher);
    });
}
