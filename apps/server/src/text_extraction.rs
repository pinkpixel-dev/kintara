//! Search and AI text extraction.
//!
//! PDFs are read through Poppler's `pdftotext`; Markdown and text documents are
//! already text and are read directly. Extraction never prevents indexing.

use std::path::Path;
use std::process::Stdio;

use tokio::process::Command;

use crate::error::AppResult;
use crate::state::AppState;

const MAX_EXTRACTED_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextStatus {
    Ok,
    Empty,
    Truncated,
    Failed,
}

impl TextStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Empty => "empty",
            Self::Truncated => "truncated",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct ExtractedText {
    pub pages: Vec<String>,
    pub status: TextStatus,
}

impl ExtractedText {
    fn failed() -> Self {
        Self {
            pages: Vec::new(),
            status: TextStatus::Failed,
        }
    }

    fn combined(&self) -> String {
        self.pages.join("\n\n")
    }
}

pub async fn extract(path: &Path, document_type: &str) -> ExtractedText {
    match document_type {
        "pdf" => extract_pdf_with(path, Path::new("pdftotext")).await,
        "md" | "txt" => match tokio::fs::read(path).await {
            Ok(bytes) => from_pages(vec![String::from_utf8_lossy(&bytes).into_owned()]),
            Err(err) => {
                tracing::debug!(path = %path.display(), %err, "could not read document text");
                ExtractedText::failed()
            }
        },
        _ => ExtractedText::failed(),
    }
}

async fn extract_pdf_with(path: &Path, program: &Path) -> ExtractedText {
    let output = Command::new(program)
        .arg("-enc")
        .arg("UTF-8")
        .arg(path)
        .arg("-")
        .stdin(Stdio::null())
        .output()
        .await;

    let Ok(output) = output else {
        tracing::debug!(program = %program.display(), "pdftotext unavailable");
        return ExtractedText::failed();
    };
    if !output.status.success() {
        tracing::debug!(path = %path.display(), "pdftotext returned a non-zero status");
        return ExtractedText::failed();
    }

    let mut pages: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .split('\u{000c}')
        .map(str::to_owned)
        .collect();
    while pages.last().is_some_and(|page| page.trim().is_empty()) {
        pages.pop();
    }
    from_pages(pages)
}

fn from_pages(pages: Vec<String>) -> ExtractedText {
    if pages.iter().all(|page| page.trim().is_empty()) {
        return ExtractedText {
            pages: Vec::new(),
            status: TextStatus::Empty,
        };
    }

    let (pages, truncated) = truncate_pages(pages, MAX_EXTRACTED_BYTES);
    ExtractedText {
        pages,
        status: if truncated {
            TextStatus::Truncated
        } else {
            TextStatus::Ok
        },
    }
}

fn truncate_pages(pages: Vec<String>, limit: usize) -> (Vec<String>, bool) {
    let total: usize = pages.iter().map(String::len).sum();
    if total <= limit {
        return (pages, false);
    }

    let mut remaining = limit;
    let mut kept = Vec::new();
    for mut page in pages {
        if remaining == 0 {
            break;
        }
        if page.len() > remaining {
            let mut end = remaining;
            while end > 0 && !page.is_char_boundary(end) {
                end -= 1;
            }
            page.truncate(end);
        }
        remaining = remaining.saturating_sub(page.len());
        kept.push(page);
    }
    (kept, true)
}

pub async fn extract_and_store(
    state: &AppState,
    document_id: i64,
    path: &Path,
    document_type: &str,
) -> AppResult<TextStatus> {
    let extracted = extract(path, document_type).await;
    let combined = extracted.combined();
    let mut tx = state.db.begin().await?;

    sqlx::query("DELETE FROM document_pages WHERE document_id = ?")
        .bind(document_id)
        .execute(&mut *tx)
        .await?;

    for (index, text) in extracted.pages.iter().enumerate() {
        sqlx::query("INSERT INTO document_pages (document_id, page_number, text) VALUES (?, ?, ?)")
            .bind(document_id)
            .bind((index + 1) as i64)
            .bind(text)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query(
        "UPDATE documents
         SET extracted_text = ?, text_status = ?, text_extracted_at = datetime('now')
         WHERE id = ?",
    )
    .bind(if combined.is_empty() {
        None
    } else {
        Some(combined)
    })
    .bind(extracted.status.as_str())
    .bind(document_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(extracted.status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn form_feeds_become_one_based_pages_without_a_trailing_empty_page() {
        let text = from_pages(
            "first page\u{000c}second page\u{000c}"
                .split('\u{000c}')
                .map(str::to_owned)
                .filter(|page| !page.is_empty())
                .collect(),
        );
        assert_eq!(text.pages, vec!["first page", "second page"]);
        assert_eq!(text.status, TextStatus::Ok);
    }

    #[test]
    fn whitespace_only_documents_are_empty() {
        let text = from_pages(vec![" \n\t".into()]);
        assert_eq!(text.status, TextStatus::Empty);
        assert!(text.pages.is_empty());
    }

    #[test]
    fn truncation_preserves_utf8_boundaries() {
        let (pages, truncated) = truncate_pages(vec!["cafe éclair".into()], 7);
        assert!(truncated);
        assert_eq!(pages, vec!["cafe é"]);
    }

    #[tokio::test]
    async fn a_missing_pdftotext_binary_degrades_to_failed() {
        let missing = PathBuf::from("/definitely/missing/kintara-pdftotext");
        let text = extract_pdf_with(Path::new("paper.pdf"), &missing).await;
        assert_eq!(text.status, TextStatus::Failed);
    }
}
