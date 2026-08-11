use serde::{Deserialize, Deserializer, Serialize};

/// Deserializer for patch fields that need to tell "absent" from "null".
///
/// `#[serde(default)]` alone is not enough: serde deserializes a JSON `null`
/// into `None`, so `Option<Option<T>>` collapses and an explicit null becomes
/// indistinguishable from an omitted field. Going through `Option<T>` first and
/// wrapping the result keeps the three cases apart — absent stays `None`, null
/// becomes `Some(None)`, and a value becomes `Some(Some(v))`.
pub fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

/// A document as it comes back from the database, including the per-user
/// reading state joined on.
#[derive(Debug, sqlx::FromRow)]
pub struct DocumentRow {
    pub id: i64,
    pub title: String,
    pub author: Option<String>,
    pub document_type: String,
    pub file_size: Option<i64>,
    pub thumbnail_name: Option<String>,
    pub summary: Option<String>,
    pub keywords: Option<String>,
    pub doi: Option<String>,
    pub isbn: Option<String>,
    pub page_count: Option<i64>,
    pub year: Option<i64>,
    pub created_at: String,
    pub modified_at: String,
    pub reading_progress: f64,
    pub is_favorite: i64,
}

/// The wire format. Deliberately does not expose `relative_path` — the client
/// addresses documents by id, and publishing filesystem layout to every browser
/// tab is how a document server leaks the shape of someone's NAS.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: i64,
    pub title: String,
    pub author: Option<String>,
    pub document_type: String,
    pub file_size: Option<i64>,
    pub summary: Option<String>,
    pub keywords: Option<String>,
    pub doi: Option<String>,
    pub isbn: Option<String>,
    pub page_count: Option<i64>,
    pub year: Option<i64>,
    pub created_at: String,
    pub modified_at: String,
    pub reading_progress: f64,
    pub is_favorite: bool,
    pub has_thumbnail: bool,
}

impl From<DocumentRow> for Document {
    fn from(row: DocumentRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            author: row.author,
            document_type: row.document_type,
            file_size: row.file_size,
            summary: row.summary,
            keywords: row.keywords,
            doi: row.doi,
            isbn: row.isbn,
            page_count: row.page_count,
            year: row.year,
            created_at: row.created_at,
            modified_at: row.modified_at,
            reading_progress: row.reading_progress,
            is_favorite: row.is_favorite != 0,
            has_thumbnail: row.thumbnail_name.is_some(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Copy, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Sort {
    /// Most recently modified first. Matches the desktop app's default view.
    #[default]
    Recent,
    Added,
    Title,
    Author,
    Year,
}

impl Sort {
    /// Returns a literal ORDER BY fragment. This is never interpolated from
    /// user input — the enum is the whitelist.
    pub fn order_by(self) -> &'static str {
        match self {
            Sort::Recent => "d.modified_at DESC",
            Sort::Added => "d.created_at DESC",
            Sort::Title => "d.title COLLATE NOCASE ASC",
            Sort::Author => "d.author COLLATE NOCASE ASC, d.title COLLATE NOCASE ASC",
            Sort::Year => "d.year DESC, d.title COLLATE NOCASE ASC",
        }
    }
}

fn default_limit() -> i64 {
    50
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    /// Free-text search, run through FTS5.
    pub q: Option<String>,
    pub library_id: Option<i64>,
    pub collection_id: Option<i64>,
    pub tag_id: Option<i64>,
    pub favorite: Option<bool>,
    #[serde(default)]
    pub sort: Sort,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

impl ListQuery {
    /// Clamps paging so a client cannot ask for the whole library in one
    /// response, or for a negative offset.
    pub fn clamped(&self) -> (i64, i64) {
        (self.limit.clamp(1, 200), self.offset.max(0))
    }
}

/// Splits raw user input into the terms both halves of search are built from.
///
/// Anything that is not a word character is dropped rather than escaped. FTS5
/// has its own query syntax, so raw input containing `"`, `*`, `(`, `-` or the
/// bare word `AND` is either a syntax error or silently does something the user
/// did not ask for — searching for `C++` should not 500.
fn search_terms(raw: &str) -> Vec<String> {
    raw.split_whitespace()
        .map(|token| {
            token
                .chars()
                .filter(|c| c.is_alphanumeric() || matches!(c, '\'' | '-' | '_' | '.'))
                .collect::<String>()
        })
        .filter(|token| !token.is_empty())
        .collect()
}

/// A user's search text, prepared for both places it has to be matched.
///
/// Title, author, keywords and summary live in `documents_fts`. Tag names do
/// not — they are in `tags`, reached through a join — so they are matched
/// separately and the two results are unioned. Denormalising tag names into the
/// FTS row was the alternative; it keeps search a single query, at the cost of
/// an index that goes quietly wrong the moment a tag write path forgets to
/// refresh it.
#[derive(Debug, Clone)]
pub struct Search {
    /// An FTS5 MATCH expression.
    pub fts: String,
    /// One LIKE pattern per term, all of which must match some tag on the
    /// document. Never empty when `parse` returned `Some`.
    pub tag_patterns: Vec<String>,
}

impl Search {
    /// Returns `None` when the input has no usable characters, which callers
    /// must treat as "matches nothing" rather than "no filter".
    pub fn parse(raw: &str) -> Option<Search> {
        let terms = search_terms(raw);
        if terms.is_empty() {
            return None;
        }

        Some(Search {
            fts: fts_expression(&terms),
            tag_patterns: terms.iter().map(|term| like_pattern(term)).collect(),
        })
    }
}

/// Builds the FTS5 MATCH expression.
///
/// Every term is quoted as an FTS5 string literal (doubling any embedded
/// quotes), and the final one gets a `*` so search feels incremental as you
/// type. Terms are space-separated, which FTS5 reads as an implicit AND.
fn fts_expression(terms: &[String]) -> String {
    let last = terms.len() - 1;
    terms
        .iter()
        .enumerate()
        .map(|(i, term)| {
            let escaped = term.replace('"', "\"\"");
            if i == last {
                format!("\"{escaped}\"*")
            } else {
                format!("\"{escaped}\"")
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Builds a LIKE pattern for matching one term against a tag name.
///
/// Substring rather than prefix, because tags are short and often compound —
/// `fi` should find `sci-fi`. LIKE's own wildcards are escaped so a tag called
/// `100%` or `draft_2` is matched literally; `search_terms` already strips most
/// of them, but the escaping does not depend on that staying true.
fn like_pattern(term: &str) -> String {
    let escaped = term
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}
