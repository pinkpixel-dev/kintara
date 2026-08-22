//! Shared document context for the AI routes.
//!
//! Chat, summarize, and find all need the same three things: the page rows, a
//! decision about whether the extracted text is usable at all, and a token
//! estimate to bound the request. They lived in whichever route needed them
//! first until a third caller arrived.

use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, sqlx::FromRow)]
pub struct PageRow {
    pub page_number: i64,
    pub text: String,
}

/// Every page of a document, in order.
///
/// Markdown and text documents extract to a single page, so a citation on one
/// of those is always page 1 and its excerpt is a literal slice of the file.
pub async fn load_pages(state: &AppState, document_id: i64) -> AppResult<Vec<PageRow>> {
    let pages: Vec<PageRow> = sqlx::query_as(
        "SELECT page_number, text FROM document_pages WHERE document_id = ? ORDER BY page_number",
    )
    .bind(document_id)
    .fetch_all(&state.db)
    .await?;

    if pages.is_empty() || pages.iter().all(|page| page.text.trim().is_empty()) {
        return Err(AppError::BadRequest(
            "this document has no extracted text".into(),
        ));
    }
    Ok(pages)
}

/// Refuses a document whose text cannot be sent honestly.
///
/// Truncated text is refused rather than sent, because an answer drawn from
/// two thirds of a document reads exactly like an answer drawn from all of it.
pub fn require_readable(status: Option<&str>) -> AppResult<()> {
    match status {
        Some("ok") => Ok(()),
        Some("truncated") => Err(AppError::BadRequest(
            "this document's extracted text was truncated and cannot be sent safely".into(),
        )),
        Some("empty") => Err(AppError::BadRequest(
            "this document has no text layer; OCR is not available".into(),
        )),
        _ => Err(AppError::BadRequest(
            "text extraction failed for this document".into(),
        )),
    }
}

/// A deliberately rough estimate, used only to refuse oversized requests before
/// they are billed. Four characters per token is close enough for that job.
pub fn approximate_tokens(text: &str) -> usize {
    text.chars().count().div_ceil(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_estimate_rounds_up() {
        assert_eq!(approximate_tokens("12345"), 2);
    }

    #[test]
    fn only_fully_extracted_text_is_sent() {
        assert!(require_readable(Some("ok")).is_ok());
        assert!(require_readable(Some("truncated")).is_err());
        assert!(require_readable(Some("empty")).is_err());
        assert!(require_readable(None).is_err());
    }
}
