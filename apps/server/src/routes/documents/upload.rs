use std::path::Path as StdPath;

use axum::extract::{Multipart, State};
use axum::http::StatusCode;
use axum::Json;

use crate::error::{AppError, AppResult};
use crate::media;
use crate::models::Document;
use crate::state::AppState;

/// Extensions the reader can actually display. Anything else is rejected at the
/// door rather than being indexed into a library entry that cannot be opened.
const ALLOWED: [&str; 3] = ["pdf", "md", "txt"];

/// Accepts a `multipart/form-data` upload with a `file` part, plus optional
/// `libraryId` and `collectionId` parts to file it on arrival.
pub async fn upload(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<Document>)> {
    let mut filename: Option<String> = None;
    let mut bytes: Option<Vec<u8>> = None;
    let mut library_id: Option<i64> = None;
    let mut collection_id: Option<i64> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|err| AppError::BadRequest(format!("malformed upload: {err}")))?
    {
        match field.name().unwrap_or_default() {
            "file" => {
                filename = field.file_name().map(media::sanitize_filename);
                bytes = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|err| AppError::BadRequest(format!("upload failed: {err}")))?
                        .to_vec(),
                );
            }
            "libraryId" => library_id = field.text().await.ok().and_then(|v| v.parse().ok()),
            "collectionId" => collection_id = field.text().await.ok().and_then(|v| v.parse().ok()),
            _ => {}
        }
    }

    let filename = filename.ok_or_else(|| AppError::BadRequest("no file provided".into()))?;
    let bytes = bytes.ok_or_else(|| AppError::BadRequest("no file provided".into()))?;

    if bytes.is_empty() {
        return Err(AppError::BadRequest("the uploaded file is empty".into()));
    }

    let extension = StdPath::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if !ALLOWED.contains(&extension.as_str()) {
        return Err(AppError::BadRequest(format!(
            "unsupported file type '{extension}' (supported: {})",
            ALLOWED.join(", ")
        )));
    }

    let hash = media::hash_bytes(&bytes);

    // The same file uploaded twice should not become two library entries.
    let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM documents WHERE file_hash = ?")
        .bind(&hash)
        .fetch_optional(&state.db)
        .await?;

    if let Some(id) = existing {
        return Err(AppError::Conflict(format!(
            "this file is already in the library as document {id}"
        )));
    }

    let relative_path = unique_relative_path(&state, &filename).await?;
    let destination = state.config.library_dir.join(&relative_path);

    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| AppError::Internal(err.into()))?;
    }

    tokio::fs::write(&destination, &bytes)
        .await
        .map_err(|err| AppError::Internal(err.into()))?;

    let metadata = if extension == "pdf" {
        media::extract_pdf_metadata(&destination).await
    } else {
        media::Metadata::default()
    };

    let title = metadata
        .title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| media::title_from_filename(&filename));

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO documents
            (title, author, relative_path, document_type, file_hash, file_size,
             keywords, page_count, year, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         RETURNING id",
    )
    .bind(&title)
    .bind(&metadata.author)
    .bind(&relative_path)
    .bind(&extension)
    .bind(&hash)
    .bind(bytes.len() as i64)
    .bind(&metadata.keywords)
    .bind(metadata.page_count)
    .bind(metadata.year)
    .fetch_one(&state.db)
    .await?;

    if extension == "pdf" {
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

    if let Some(library_id) = library_id {
        sqlx::query(
            "INSERT OR IGNORE INTO library_documents (library_id, document_id) VALUES (?, ?)",
        )
        .bind(library_id)
        .bind(id)
        .execute(&state.db)
        .await?;
    }

    if let Some(collection_id) = collection_id {
        sqlx::query(
            "INSERT OR IGNORE INTO document_collections (collection_id, document_id) VALUES (?, ?)",
        )
        .bind(collection_id)
        .bind(id)
        .execute(&state.db)
        .await?;
    }

    let document = super::fetch_one(&state, id, 0).await?;
    Ok((StatusCode::CREATED, Json(document)))
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
