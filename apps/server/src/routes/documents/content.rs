use axum::extract::{Path, Request, State};
use axum::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use tower::ServiceExt;
use tower_http::services::ServeFile;

use crate::access;
use crate::current_user::CurrentUser;
use crate::error::{AppError, AppResult};
use crate::files::{download_filename, resolve_in_root};
use crate::state::AppState;

/// Where a document lives on disk, as stored in the database.
struct Located {
    path: std::path::PathBuf,
    relative_path: String,
    document_type: String,
}

async fn locate(state: &AppState, id: i64, user_id: i64) -> AppResult<Located> {
    access::require_document_view(state, id, user_id).await?;
    let (relative_path, document_type): (String, String) =
        sqlx::query_as("SELECT relative_path, document_type FROM documents WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NotFound)?;

    let path = resolve_in_root(&state.config.library_dir, &relative_path)?;

    Ok(Located {
        path,
        relative_path,
        document_type,
    })
}

fn content_type_for(document_type: &str, path: &std::path::Path) -> String {
    match document_type {
        "pdf" => "application/pdf".to_string(),
        "md" => "text/markdown; charset=utf-8".to_string(),
        "txt" => "text/plain; charset=utf-8".to_string(),
        _ => mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string(),
    }
}

/// Serves the document itself.
///
/// This delegates to `ServeFile` rather than reading the file into memory,
/// which is what provides Range support. pdf.js fetches a PDF in chunks, so
/// without ranges every page turn on a phone re-downloads the whole document —
/// and a 200 MB scan would also mean a 200 MB allocation per reader.
pub async fn file(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
    request: Request,
) -> AppResult<Response> {
    let located = locate(&state, id, user_id).await?;
    let content_type = content_type_for(&located.document_type, &located.path);

    let response = ServeFile::new_with_mime(
        &located.path,
        &content_type
            .parse()
            .unwrap_or(mime_guess::mime::APPLICATION_OCTET_STREAM),
    )
    .oneshot(request)
    .await
    .map_err(|err| AppError::Internal(anyhow::anyhow!("failed to serve document: {err}")))?;

    Ok(response.into_response())
}

/// Same bytes as `file`, but asks the browser to save rather than display.
pub async fn download(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
    request: Request,
) -> AppResult<Response> {
    let located = locate(&state, id, user_id).await?;
    let filename = download_filename(&located.relative_path, id);

    let mut response = ServeFile::new(&located.path)
        .oneshot(request)
        .await
        .map_err(|err| AppError::Internal(anyhow::anyhow!("failed to serve document: {err}")))?
        .into_response();

    // RFC 6266: the plain filename is ASCII-sanitised for old clients, and
    // filename* carries the real UTF-8 name for everyone else.
    let ascii: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let encoded = percent_encode_utf8(&filename);
    let disposition = format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}");

    if let Ok(value) = HeaderValue::from_str(&disposition) {
        response.headers_mut().insert(CONTENT_DISPOSITION, value);
    }

    Ok(response)
}

/// Serves a generated thumbnail from the data directory.
pub async fn thumbnail(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<Response> {
    access::require_document_view(&state, id, user_id).await?;
    let name: Option<String> =
        sqlx::query_scalar("SELECT thumbnail_name FROM documents WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NotFound)?;

    let name = name.ok_or(AppError::NotFound)?;
    let path = resolve_in_root(&state.config.thumbnail_dir(), &name)?;

    let bytes = tokio::fs::read(&path).await.map_err(|_| AppError::NotFound)?;

    Ok((
        StatusCode::OK,
        [
            (
                CONTENT_TYPE,
                mime_guess::from_path(&path)
                    .first_or_octet_stream()
                    .to_string(),
            ),
            // Thumbnails are regenerated under a new filename when a document
            // changes, so the URL is effectively content-addressed per version
            // and can be cached hard.
            (
                axum::http::header::CACHE_CONTROL,
                "public, max-age=604800".to_string(),
            ),
        ],
        bytes,
    )
        .into_response())
}

fn percent_encode_utf8(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}
