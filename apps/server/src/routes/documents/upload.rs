use std::path::{Path as StdPath, PathBuf};

use axum::extract::{Multipart, State};
use axum::http::StatusCode;
use axum::Json;
use sqlx::{Sqlite, Transaction};
use tokio::io::AsyncWriteExt;

use crate::access;
use crate::current_user::CurrentUser;
use crate::error::{AppError, AppResult};
use crate::media;
use crate::models::Document;
use crate::state::AppState;
use crate::text_extraction;

/// Extensions the reader can actually display. Anything else is rejected at the
/// door rather than being indexed into a library entry that cannot be opened.
const ALLOWED: [&str; 3] = ["pdf", "md", "txt"];

/// Image types accepted as a custom cover.
const ALLOWED_COVER: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

/// Uploads land here first, then get renamed into place.
///
/// Inside the library root so the rename is atomic — a temp file in the data
/// directory would be on a different mount on any real NAS, turning the rename
/// into a full copy. The leading dot keeps the scanner out of it.
const INCOMING_DIR: &str = ".kintara-incoming";

/// Accepts a `multipart/form-data` upload with a `file` part, plus optional
/// `libraryId` and `collectionId` parts to file it on arrival.
///
/// The file is streamed to disk rather than buffered. A magazine scan can run
/// to hundreds of megabytes, and holding that in memory per upload is how a
/// NAS with 2 GB of RAM falls over.
pub async fn upload(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<Document>)> {
    let incoming = state.config.library_dir.join(INCOMING_DIR);
    tokio::fs::create_dir_all(&incoming)
        .await
        .map_err(|err| AppError::Internal(err.into()))?;

    let mut upload: Option<StreamedUpload> = None;
    let mut library_id: Option<i64> = None;
    let mut collection_id: Option<i64> = None;

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|err| AppError::BadRequest(format!("malformed upload: {err}")))?
    {
        match field.name().unwrap_or_default() {
            "file" => {
                let filename = field
                    .file_name()
                    .map(media::sanitize_filename)
                    .ok_or_else(|| AppError::BadRequest("no filename provided".into()))?;

                let extension = extension_of(&filename);
                if !ALLOWED.contains(&extension.as_str()) {
                    return Err(AppError::BadRequest(format!(
                        "unsupported file type '{extension}' (supported: {})",
                        ALLOWED.join(", ")
                    )));
                }

                let temp_path = incoming.join(format!(
                    ".upload-{}-{}",
                    std::process::id(),
                    chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
                ));

                let mut file = tokio::fs::File::create(&temp_path)
                    .await
                    .map_err(|err| AppError::Internal(err.into()))?;
                let mut hasher = blake3::Hasher::new();
                let mut size: u64 = 0;

                loop {
                    let chunk = match field.chunk().await {
                        Ok(Some(chunk)) => chunk,
                        Ok(None) => break,
                        Err(err) => {
                            // Clean up before bailing, or a failed upload leaves
                            // a partial file behind for every retry.
                            let _ = tokio::fs::remove_file(&temp_path).await;
                            return Err(AppError::BadRequest(format!("upload failed: {err}")));
                        }
                    };

                    hasher.update(&chunk);
                    size += chunk.len() as u64;

                    if let Err(err) = file.write_all(&chunk).await {
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        return Err(AppError::Internal(err.into()));
                    }
                }

                if let Err(err) = file.flush().await {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return Err(AppError::Internal(err.into()));
                }
                drop(file);

                upload = Some(StreamedUpload {
                    filename,
                    extension,
                    temp_path,
                    hash: hasher.finalize().to_hex().to_string(),
                    size: size as i64,
                });
            }
            "libraryId" => library_id = field.text().await.ok().and_then(|v| v.parse().ok()),
            "collectionId" => collection_id = field.text().await.ok().and_then(|v| v.parse().ok()),
            _ => {}
        }
    }

    let upload = upload.ok_or_else(|| AppError::BadRequest("no file provided".into()))?;

    // A new upload moves the temp file into place. A recovered duplicate does
    // not need the streamed copy, so remove anything that remains either way.
    let result = finish(&state, user_id, &upload, library_id, collection_id).await;
    let _ = tokio::fs::remove_file(&upload.temp_path).await;
    result
}

struct StreamedUpload {
    filename: String,
    extension: String,
    temp_path: PathBuf,
    hash: String,
    size: i64,
}

async fn finish(
    state: &AppState,
    user_id: i64,
    upload: &StreamedUpload,
    mut library_id: Option<i64>,
    collection_id: Option<i64>,
) -> AppResult<(StatusCode, Json<Document>)> {
    if upload.size == 0 {
        return Err(AppError::BadRequest("the uploaded file is empty".into()));
    }

    if let Some(collection_id) = collection_id {
        let parent_id: i64 =
            sqlx::query_scalar("SELECT library_id FROM collections WHERE id = ?")
                .bind(collection_id)
                .fetch_optional(&state.db)
                .await?
                .ok_or(AppError::NotFound)?;
        access::require_library_editor(state, parent_id, user_id).await?;
        if library_id.is_some_and(|id| id != parent_id) {
            return Err(AppError::BadRequest(
                "the collection does not belong to the selected library".into(),
            ));
        }
        library_id = Some(parent_id);
    } else if let Some(library_id) = library_id {
        access::require_library_editor(state, library_id, user_id).await?;
    }

    // Retrying the same owned file repairs any placement that an interrupted
    // first request did not finish. This also covers a successful upload whose
    // response never reached the browser.
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM documents WHERE file_hash = ? AND owner_id = ?",
    )
        .bind(&upload.hash)
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;

    if let Some(id) = existing {
        let mut tx = state.db.begin().await?;
        add_placement(&mut tx, id, library_id, collection_id).await?;
        tx.commit().await?;

        let document = super::fetch_one(state, id, user_id).await?;
        return Ok((StatusCode::OK, Json(document)));
    }

    let relative_path = unique_relative_path(state, &upload.filename).await?;
    let destination = state.config.library_dir.join(&relative_path);

    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| AppError::Internal(err.into()))?;
    }

    // Same filesystem as the temp file, so this is atomic rather than a copy.
    tokio::fs::rename(&upload.temp_path, &destination)
        .await
        .map_err(|err| AppError::Internal(err.into()))?;

    let metadata = if upload.extension == "pdf" {
        media::extract_pdf_metadata(&destination).await
    } else {
        media::Metadata::default()
    };

    let title = metadata
        .title
        .clone()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| media::title_from_filename(&upload.filename));

    // The row and its requested placement are one database change. Thumbnail
    // and text indexing happen afterwards because the received file remains a
    // useful document even when either derived operation fails.
    let mut tx = state.db.begin().await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO documents
            (owner_id, title, author, relative_path, document_type, file_hash, file_size,
             keywords, page_count, year, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         RETURNING id",
    )
    .bind(user_id)
    .bind(&title)
    .bind(&metadata.author)
    .bind(&relative_path)
    .bind(&upload.extension)
    .bind(&upload.hash)
    .bind(upload.size)
    .bind(&metadata.keywords)
    .bind(metadata.page_count)
    .bind(metadata.year)
    .fetch_one(&mut *tx)
    .await?;

    add_placement(&mut tx, id, library_id, collection_id).await?;
    tx.commit().await?;

    if upload.extension == "pdf" {
        if let Some(name) =
            media::generate_thumbnail(&destination, &state.config.thumbnail_dir(), id).await
        {
            sqlx::query("UPDATE documents SET thumbnail_name = ? WHERE id = ?")
                .bind(&name)
                .bind(id)
                .execute(&state.db)
                .await?;
        }
    }

    text_extraction::extract_and_store(state, id, &destination, &upload.extension).await?;

    let document = super::fetch_one(state, id, user_id).await?;
    Ok((StatusCode::CREATED, Json(document)))
}

async fn add_placement(
    tx: &mut Transaction<'_, Sqlite>,
    document_id: i64,
    library_id: Option<i64>,
    collection_id: Option<i64>,
) -> AppResult<()> {
    if let Some(library_id) = library_id {
        sqlx::query(
            "INSERT OR IGNORE INTO library_documents (library_id, document_id) VALUES (?, ?)",
        )
        .bind(library_id)
        .bind(document_id)
        .execute(&mut **tx)
        .await?;
    }

    if let Some(collection_id) = collection_id {
        sqlx::query(
            "INSERT OR IGNORE INTO document_collections (collection_id, document_id) VALUES (?, ?)",
        )
        .bind(collection_id)
        .bind(document_id)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

/// Replaces a document's cover with an uploaded image.
///
/// Covers live in the data directory alongside generated thumbnails, not in the
/// library, because they are derived assets rather than documents.
pub async fn upload_cover(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    axum::extract::Path(id): axum::extract::Path<i64>,
    mut multipart: Multipart,
) -> AppResult<StatusCode> {
    access::require_document_editor(&state, id, user_id).await?;
    let previous: Option<Option<String>> =
        sqlx::query_scalar("SELECT thumbnail_name FROM documents WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    let previous = previous.ok_or(AppError::NotFound)?;

    let mut filename: Option<String> = None;
    let mut bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|err| AppError::BadRequest(format!("malformed upload: {err}")))?
    {
        if field.name().unwrap_or_default() == "file" {
            filename = field.file_name().map(media::sanitize_filename);
            // Covers are images sized for a grid tile, so buffering one is fine.
            bytes = Some(
                field
                    .bytes()
                    .await
                    .map_err(|err| AppError::BadRequest(format!("upload failed: {err}")))?
                    .to_vec(),
            );
        }
    }

    let filename = filename.ok_or_else(|| AppError::BadRequest("no file provided".into()))?;
    let bytes = bytes.ok_or_else(|| AppError::BadRequest("no file provided".into()))?;

    if bytes.is_empty() {
        return Err(AppError::BadRequest("the uploaded image is empty".into()));
    }

    let extension = extension_of(&filename);
    if !ALLOWED_COVER.contains(&extension.as_str()) {
        return Err(AppError::BadRequest(format!(
            "unsupported image type '{extension}' (supported: {})",
            ALLOWED_COVER.join(", ")
        )));
    }

    // A new filename each time, so the long cache header on the thumbnail route
    // never serves a stale cover.
    let name = format!("cover-{id}-{}.{extension}", chrono::Utc::now().timestamp());
    tokio::fs::write(state.config.thumbnail_dir().join(&name), &bytes)
        .await
        .map_err(|err| AppError::Internal(err.into()))?;

    sqlx::query("UPDATE documents SET thumbnail_name = ? WHERE id = ?")
        .bind(&name)
        .bind(id)
        .execute(&state.db)
        .await?;

    if let Some(old) = previous {
        if let Ok(path) = crate::files::resolve_in_root(&state.config.thumbnail_dir(), &old) {
            let _ = tokio::fs::remove_file(&path).await;
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

fn extension_of(filename: &str) -> String {
    StdPath::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default()
}

/// Finds a free path for `filename`, appending ` (2)`, ` (3)` and so on.
///
/// Two different documents can legitimately share a filename, and
/// `relative_path` is UNIQUE, so a collision must not fail the upload.
async fn unique_relative_path(state: &AppState, filename: &str) -> AppResult<String> {
    let path = StdPath::new(filename);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document");
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("bin");

    for attempt in 1..1000 {
        let candidate = if attempt == 1 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem} ({attempt}).{extension}")
        };

        let taken: Option<i64> =
            sqlx::query_scalar("SELECT id FROM documents WHERE relative_path = ?")
                .bind(&candidate)
                .fetch_optional(&state.db)
                .await?;

        if taken.is_none() && !state.config.library_dir.join(&candidate).exists() {
            return Ok(candidate);
        }
    }

    Err(AppError::Internal(anyhow::anyhow!(
        "could not find a free filename for {filename}"
    )))
}
