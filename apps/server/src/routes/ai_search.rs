//! Natural-language library search.
//!
//! The model never sees document text here and never returns documents. It
//! rewrites a sentence into the same filters the sidebar already produces —
//! free text, a library, a collection, a tag, favourites, and a sort order —
//! and the browser runs that through the existing `/api/documents` path. One
//! result surface, one query builder, and a rewrite that can be read and undone
//! rather than a ranking nobody can explain.
//!
//! What does leave the machine is the request itself plus the names of the
//! libraries, collections, and tags the person can see. Ids are resolved back
//! against that same catalogue afterwards, so a hallucinated or borrowed id
//! cannot widen anyone's access.

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;

use crate::ai::providers::{self, GenerateRequest, JsonSchema};
use crate::ai::search_rewrite::{
    Catalog, CollectionRow, NamedRow, RewrittenSearch, SearchInterpretation, build_input, resolve,
    search_schema,
};
use crate::current_user::AuthenticatedUser;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Long enough for a real sentence, short enough that the request cannot become
/// a channel for pasting a document into the prompt.
const MAX_REQUEST_CHARS: usize = 500;
/// Catalogue ceilings. A very large library would otherwise build a prompt that
/// costs more than the search is worth.
const MAX_LIBRARIES: i64 = 100;
const MAX_COLLECTIONS: i64 = 300;
const MAX_TAGS: i64 = 300;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    request: String,
    /// The view the person is searching from. A hint only — the model may leave
    /// the scope, and often should when asked to look everywhere.
    #[serde(default)]
    library_id: Option<i64>,
    #[serde(default)]
    collection_id: Option<i64>,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/search", post(search))
}

pub async fn search(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
    Json(body): Json<SearchRequest>,
) -> AppResult<Json<SearchInterpretation>> {
    let request = body.request.trim();
    if request.is_empty() {
        return Err(AppError::BadRequest(
            "describe what you are looking for".into(),
        ));
    }
    if request.chars().count() > MAX_REQUEST_CHARS {
        return Err(AppError::BadRequest(format!(
            "search requests must be {MAX_REQUEST_CHARS} characters or fewer"
        )));
    }

    let configured = super::ai::configured_provider(&state, user_id).await?;
    let catalog = load_catalog(&state, user_id).await?;
    let input = build_input(request, &catalog, body.library_id, body.collection_id);

    let result = providers::generate(
        &state.http,
        GenerateRequest {
            provider: configured.provider,
            api_key: &configured.api_key,
            model: &configured.model,
            instructions: crate::ai::search_rewrite::INSTRUCTIONS,
            input: &input,
            reasoning: Some(&configured.reasoning),
            temperature: configured.temperature,
            response_schema: Some(JsonSchema {
                name: "library_search",
                schema: search_schema(),
            }),
            max_output_tokens: 2_000,
        },
    )
    .await?;

    let parsed: RewrittenSearch = serde_json::from_str(&result.text)
        .map_err(|err| providers::structured_error(&err, "search rewrite"))?;

    sqlx::query(
        "INSERT INTO ai_usage (user_id, feature, provider, model, input_tokens, output_tokens)
         VALUES (?, 'search', ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(configured.provider.as_str())
    .bind(&configured.model)
    .bind(result.input_tokens)
    .bind(result.output_tokens)
    .execute(&state.db)
    .await?;

    Ok(Json(resolve(parsed, &catalog)))
}

async fn load_catalog(state: &AppState, user_id: i64) -> AppResult<Catalog> {
    let libraries: Vec<NamedRow> = sqlx::query_as(
        "SELECT l.id, l.name FROM libraries l
         LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
         WHERE l.owner_id = ? OR lm.user_id IS NOT NULL
         ORDER BY l.name COLLATE NOCASE ASC LIMIT ?",
    )
    .bind(user_id)
    .bind(user_id)
    .bind(MAX_LIBRARIES)
    .fetch_all(&state.db)
    .await?;

    let collections: Vec<CollectionRow> = sqlx::query_as(
        "SELECT c.id, c.name, c.library_id FROM collections c
         JOIN libraries l ON l.id = c.library_id
         LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
         WHERE l.owner_id = ? OR lm.user_id IS NOT NULL
         ORDER BY c.name COLLATE NOCASE ASC LIMIT ?",
    )
    .bind(user_id)
    .bind(user_id)
    .bind(MAX_COLLECTIONS)
    .fetch_all(&state.db)
    .await?;

    // Mirrors the visibility rule in `tags::list`: a tag the user owns, or one
    // attached to a document they can already see.
    let tags: Vec<NamedRow> = sqlx::query_as(
        "SELECT t.id, t.name FROM tags t
         WHERE t.owner_id = ? OR EXISTS (
            SELECT 1 FROM document_tags dt
            JOIN documents d ON d.id = dt.document_id
            WHERE dt.tag_id = t.id AND (d.owner_id = ? OR EXISTS (
                SELECT 1 FROM library_documents ld
                JOIN libraries l ON l.id = ld.library_id
                LEFT JOIN library_members lm
                  ON lm.library_id = l.id AND lm.user_id = ?
                WHERE ld.document_id = d.id
                  AND (l.owner_id = ? OR lm.user_id IS NOT NULL)
            ))
         )
         ORDER BY t.name COLLATE NOCASE ASC LIMIT ?",
    )
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .bind(MAX_TAGS)
    .fetch_all(&state.db)
    .await?;

    Ok(Catalog {
        libraries,
        collections,
        tags,
    })
}
