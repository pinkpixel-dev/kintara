//! Turning files on disk into library entries.
//!
//! This is the shared core: the startup sweep and the filesystem watcher both
//! call into it, so a file gets identical treatment whether it was dropped over
//! SMB, copied in by hand, or uploaded through the API.

use std::path::{Component, Path};

use crate::error::AppResult;
use crate::media;
use crate::state::AppState;

/// Extensions the readers can display. Everything else on the share is ignored
/// rather than indexed into an entry that cannot be opened.
pub const INDEXABLE: [&str; 3] = ["pdf", "md", "txt"];

/// Directories NAS software keeps beside your files. Indexing their contents
/// produces a library full of thumbnails and deleted files.
const IGNORED_DIRS: [&str; 5] = ["@eaDir", "#recycle", "#snapshot", "lost+found", "$RECYCLE.BIN"];

/// True when any component of a library-relative path should be skipped.
///
/// Checked against the relative path, not the absolute one — the library may
/// itself sit under a dotted directory, and that is no reason to ignore it.
pub fn is_ignored_relative(relative: &str) -> bool {
    Path::new(relative).components().any(|component| {
        let Component::Normal(part) = component else {
            return false;
        };
        let part = part.to_str().unwrap_or_default();
        part.starts_with('.') || IGNORED_DIRS.iter().any(|dir| part.eq_ignore_ascii_case(dir))
    })
}

pub fn is_indexable(path: &Path) -> bool {
    // Editors and sync clients litter the share with partial files; indexing
    // them produces entries that vanish moments later.
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    if name.starts_with('.') || name.starts_with('~') || name.ends_with(".part") {
        return false;
    }

    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| INDEXABLE.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Streams a file through the hasher, returning its hash and size.
async fn hash_file(path: &Path) -> std::io::Result<(String, i64)> {
    use tokio::io::AsyncReadExt;

    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; 128 * 1024];
    let mut size: i64 = 0;

    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size += read as i64;
    }

    Ok((hasher.finalize().to_hex().to_string(), size))
}

/// Path relative to the library root, in the form stored in the database.
pub fn relative_to_root(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .and_then(|p| p.to_str())
        .map(|p| p.to_string())
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Added(i64),
    Updated(i64),
    /// Content already present under a different name, or unchanged.
    Skipped,
}

/// Indexes one file, adding it or refreshing it as needed.
///
/// Identity is the relative path; content changes are detected by hash. A file
/// whose hash already exists elsewhere in the library is skipped rather than
/// duplicated, which is what stops a copy of a paper becoming a second entry.
pub async fn index_file(state: &AppState, path: &Path) -> AppResult<Outcome> {
    let Some(relative_path) = relative_to_root(&state.config.library_dir, path) else {
        return Ok(Outcome::Skipped);
    };

    if is_ignored_relative(&relative_path) {
        return Ok(Outcome::Skipped);
    }

    // Hashed in chunks rather than read whole: a magazine scan can be hundreds
    // of megabytes, and a scan of a full library would otherwise load each one
    // into memory in turn.
    let (hash, size) = match hash_file(path).await {
        Ok(result) => result,
        // Racing a copy still in progress is normal on a network share.
        Err(err) => {
            tracing::debug!(path = %path.display(), %err, "could not read file; skipping");
            return Ok(Outcome::Skipped);
        }
    };

    if size == 0 {
        return Ok(Outcome::Skipped);
    }

    let existing: Option<(i64, Option<String>)> =
        sqlx::query_as("SELECT id, file_hash FROM documents WHERE relative_path = ?")
            .bind(&relative_path)
            .fetch_optional(&state.db)
            .await?;

    if let Some((id, existing_hash)) = existing {
        if existing_hash.as_deref() == Some(hash.as_str()) {
            return Ok(Outcome::Skipped);
        }
        refresh(state, id, path, &hash, size).await?;
        return Ok(Outcome::Updated(id));
    }

    // Same content under a different path — a copy, or a rename the watcher saw
    // as a create. Move the existing row rather than duplicating it.
    let moved: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM documents WHERE file_hash = ? AND relative_path != ?",
    )
    .bind(&hash)
    .bind(&relative_path)
    .fetch_optional(&state.db)
    .await?;

    if let Some(id) = moved {
        let still_there: Option<String> =
            sqlx::query_scalar("SELECT relative_path FROM documents WHERE id = ?")
                .bind(id)
                .fetch_one(&state.db)
                .await?;

        // If the old path is gone this was a rename; if it still exists this is
        // a genuine duplicate and there is nothing to do.
        if let Some(old) = still_there {
            if !state.config.library_dir.join(&old).exists() {
                sqlx::query("UPDATE documents SET relative_path = ? WHERE id = ?")
                    .bind(&relative_path)
                    .bind(id)
                    .execute(&state.db)
                    .await?;
                tracing::info!(%old, new = %relative_path, "document moved");
                return Ok(Outcome::Updated(id));
            }
        }
        return Ok(Outcome::Skipped);
    }

    Ok(Outcome::Added(add(state, path, &relative_path, &hash, size).await?))
}

async fn add(
    state: &AppState,
    path: &Path,
    relative_path: &str,
    hash: &str,
    size: i64,
) -> AppResult<i64> {
    let extension = extension_of(path);
    let metadata = if extension == "pdf" {
        media::extract_pdf_metadata(path).await
    } else {
        media::Metadata::default()
    };

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(relative_path);

    let title = metadata
        .title
        .clone()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| media::title_from_filename(filename));

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO documents
            (title, author, relative_path, document_type, file_hash, file_size,
             keywords, page_count, year, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         RETURNING id",
    )
    .bind(&title)
    .bind(&metadata.author)
    .bind(relative_path)
    .bind(&extension)
    .bind(hash)
    .bind(size)
    .bind(&metadata.keywords)
    .bind(metadata.page_count)
    .bind(metadata.year)
    .fetch_one(&state.db)
    .await?;

    if extension == "pdf" {
        if let Some(name) =
            media::generate_thumbnail(path, &state.config.thumbnail_dir(), id).await
        {
            sqlx::query("UPDATE documents SET thumbnail_name = ? WHERE id = ?")
                .bind(&name)
                .bind(id)
                .execute(&state.db)
                .await?;
        }
    }

    tracing::info!(id, path = %relative_path, "indexed new document");
    Ok(id)
}

/// Refreshes a document whose bytes changed, leaving user-edited metadata alone.
async fn refresh(
    state: &AppState,
    id: i64,
    path: &Path,
    hash: &str,
    size: i64,
) -> AppResult<()> {
    let extension = extension_of(path);

    // Title, author, and the rest are deliberately not re-read: the user may
    // have corrected them, and a file being touched is no reason to discard that.
    sqlx::query(
        "UPDATE documents
         SET file_hash = ?, file_size = ?, modified_at = datetime('now'), indexed_at = datetime('now')
         WHERE id = ?",
    )
    .bind(hash)
    .bind(size)
    .bind(id)
    .execute(&state.db)
    .await?;

    if extension == "pdf" {
        let previous: Option<String> =
            sqlx::query_scalar("SELECT thumbnail_name FROM documents WHERE id = ?")
                .bind(id)
                .fetch_one(&state.db)
                .await?;

        if let Some(name) =
            media::generate_thumbnail(path, &state.config.thumbnail_dir(), id).await
        {
            sqlx::query("UPDATE documents SET thumbnail_name = ? WHERE id = ?")
                .bind(&name)
                .bind(id)
                .execute(&state.db)
                .await?;

            if let Some(old) = previous {
                if let Ok(old_path) =
                    crate::files::resolve_in_root(&state.config.thumbnail_dir(), &old)
                {
                    let _ = tokio::fs::remove_file(old_path).await;
                }
            }
        }
    }

    tracing::info!(id, "reindexed changed document");
    Ok(())
}

/// Removes a document whose file has gone from the library.
pub async fn forget_path(state: &AppState, relative_path: &str) -> AppResult<bool> {
    let row: Option<(i64, Option<String>)> =
        sqlx::query_as("SELECT id, thumbnail_name FROM documents WHERE relative_path = ?")
            .bind(relative_path)
            .fetch_optional(&state.db)
            .await?;

    let Some((id, thumbnail)) = row else {
        return Ok(false);
    };

    sqlx::query("DELETE FROM documents WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await?;

    if let Some(name) = thumbnail {
        if let Ok(path) = crate::files::resolve_in_root(&state.config.thumbnail_dir(), &name) {
            let _ = tokio::fs::remove_file(path).await;
        }
    }

    tracing::info!(id, path = %relative_path, "document removed from library");
    Ok(true)
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn only_readable_document_types_are_indexed() {
        assert!(is_indexable(Path::new("/lib/paper.pdf")));
        assert!(is_indexable(Path::new("/lib/notes.MD")));
        assert!(is_indexable(Path::new("/lib/plain.txt")));
        assert!(!is_indexable(Path::new("/lib/photo.jpg")));
        assert!(!is_indexable(Path::new("/lib/archive.zip")));
    }

    #[test]
    fn partial_and_hidden_files_are_ignored() {
        // Sync clients and editors leave these lying around mid-write.
        assert!(!is_indexable(Path::new("/lib/.hidden.pdf")));
        assert!(!is_indexable(Path::new("/lib/~lock.pdf")));
        assert!(!is_indexable(Path::new("/lib/download.pdf.part")));
    }

    #[test]
    fn paths_are_stored_relative_to_the_library_root() {
        let root = PathBuf::from("/library");
        assert_eq!(
            relative_to_root(&root, Path::new("/library/papers/a.pdf")).as_deref(),
            Some("papers/a.pdf")
        );
        assert_eq!(relative_to_root(&root, Path::new("/elsewhere/a.pdf")), None);
    }
}
