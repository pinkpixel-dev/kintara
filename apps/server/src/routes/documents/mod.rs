mod content;
mod mutate;
mod upload;

use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use sqlx::{QueryBuilder, Sqlite};
use tower_http::compression::CompressionLayer;

use crate::current_user::CurrentUser;
use crate::error::{AppError, AppResult};
use crate::models::{fts_query, Document, DocumentRow, ListQuery, Page};
use crate::state::AppState;

pub fn router(max_upload_bytes: usize) -> Router<AppState> {
    // JSON metadata: small, repetitive, worth compressing.
    let metadata = Router::new()
        .route(
            "/",
            get(list).post(upload::upload).layer(DefaultBodyLimit::max(max_upload_bytes)),
        )
        .route("/{id}", get(get_one).patch(mutate::update).delete(mutate::delete))
        .route("/{id}/progress", put(mutate::set_progress))
        .route("/{id}/favorite", put(mutate::set_favorite))
        .route("/{id}/tags", get(crate::routes::tags::for_document))
        .route(
            "/{id}/tags/{tag_id}",
            post(crate::routes::tags::attach).delete(crate::routes::tags::detach),
        )
        .route("/{id}/annotations", get(crate::routes::annotations::for_document))
        .route(
            "/{id}/cover",
            // Covers are images; a much smaller ceiling than whole documents.
            post(upload::upload_cover).layer(DefaultBodyLimit::max(32 * 1024 * 1024)),
        )
        .layer(CompressionLayer::new());

    // Document bytes: served by ServeFile with Range support, and never
    // compressed. See the note in routes::router.
    let content = Router::new()
        .route("/{id}/file", get(content::file))
        .route("/{id}/thumbnail", get(content::thumbnail))
        .route("/{id}/download", get(content::download));

    metadata.merge(content)
}

/// Columns shared by the list and single-document queries.
///
/// A macro rather than a const so both call sites get a `&'static str` literal.
/// sqlx 0.9 refuses non-static query strings unless you wrap them in
/// `AssertSqlSafe`, and keeping the SQL genuinely static is better than
/// asserting that a `format!` result is safe.
///
/// The LEFT JOIN is what makes per-user state work without backfilling a row
/// for every (user, document) pair on user creation — a missing row simply
/// means "never opened, not favourited".
macro_rules! select_columns {
    () => {
        "
    d.id, d.title, d.author, d.document_type, d.file_size, d.thumbnail_name,
    d.summary, d.keywords, d.doi, d.isbn, d.page_count, d.year,
    d.created_at, d.modified_at,
    COALESCE(s.reading_progress, 0.0) AS reading_progress,
    COALESCE(s.is_favorite, 0)        AS is_favorite
"
    };
}

/// Applies every filter shared by the count and page queries, so the total can
/// never drift from the rows actually returned.
fn push_filters(builder: &mut QueryBuilder<Sqlite>, query: &ListQuery, search: Option<&str>) {
    builder.push(" WHERE 1 = 1");

    if let Some(expression) = search {
        builder
            .push(" AND d.id IN (SELECT rowid FROM documents_fts WHERE documents_fts MATCH ")
            .push_bind(expression)
            .push(")");
    }

    if let Some(library_id) = query.library_id {
        builder
            .push(" AND d.id IN (SELECT document_id FROM library_documents WHERE library_id = ")
            .push_bind(library_id)
            .push(")");
    }

    if let Some(collection_id) = query.collection_id {
        builder
            .push(
                " AND d.id IN (SELECT document_id FROM document_collections WHERE collection_id = ",
            )
            .push_bind(collection_id)
            .push(")");
    }

    if let Some(tag_id) = query.tag_id {
        builder
            .push(" AND d.id IN (SELECT document_id FROM document_tags WHERE tag_id = ")
            .push_bind(tag_id)
            .push(")");
    }

    if query.favorite == Some(true) {
        builder.push(" AND COALESCE(s.is_favorite, 0) = 1");
    }
}

pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<Page<Document>>> {
    let (limit, offset) = query.clamped();

    // An unusable search string (all punctuation, say) must return nothing
    // rather than quietly returning the whole library.
    let search = match query.q.as_deref().map(str::trim) {
        Some(raw) if !raw.is_empty() => match fts_query(raw) {
            Some(expression) => Some(expression),
            None => {
                return Ok(Json(Page {
                    items: Vec::new(),
                    total: 0,
                    limit,
                    offset,
                }))
            }
        },
        _ => None,
    };

    let mut count = QueryBuilder::<Sqlite>::new(
        "SELECT COUNT(*) FROM documents d
         LEFT JOIN user_document_state s ON s.document_id = d.id AND s.user_id = ",
    );
    count.push_bind(user_id);
    push_filters(&mut count, &query, search.as_deref());

    let total: i64 = count.build_query_scalar().fetch_one(&state.db).await?;

    let mut page = QueryBuilder::<Sqlite>::new("SELECT ");
    page.push(select_columns!()).push(
        " FROM documents d
          LEFT JOIN user_document_state s ON s.document_id = d.id AND s.user_id = ",
    );
    page.push_bind(user_id);
    push_filters(&mut page, &query, search.as_deref());

    // Sort is an enum, so this fragment is a literal rather than user input.
    page.push(" ORDER BY ").push(query.sort.order_by());
    page.push(" LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);

    let rows: Vec<DocumentRow> = page.build_query_as().fetch_all(&state.db).await?;

    Ok(Json(Page {
        items: rows.into_iter().map(Document::from).collect(),
        total,
        limit,
        offset,
    }))
}

pub async fn get_one(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(id): Path<i64>,
) -> AppResult<Json<Document>> {
    const SQL: &str = concat!(
        "SELECT ",
        select_columns!(),
        " FROM documents d
          LEFT JOIN user_document_state s ON s.document_id = d.id AND s.user_id = ?
          WHERE d.id = ?"
    );

    let row: DocumentRow = sqlx::query_as(SQL)
        .bind(user_id)
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;

    Ok(Json(row.into()))
}

/// Fetches one document as the wire format, for handlers that need to return a
/// freshly created or updated row.
pub(crate) async fn fetch_one(state: &AppState, id: i64, user_id: i64) -> AppResult<Document> {
    const SQL: &str = concat!(
        "SELECT ",
        select_columns!(),
        " FROM documents d
          LEFT JOIN user_document_state s ON s.document_id = d.id AND s.user_id = ?
          WHERE d.id = ?"
    );

    let row: DocumentRow = sqlx::query_as(SQL)
        .bind(user_id)
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;

    Ok(row.into())
}
