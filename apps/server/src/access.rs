use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LibraryRole {
    Owner,
    Editor,
    Viewer,
}

impl LibraryRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Editor => "editor",
            Self::Viewer => "viewer",
        }
    }

    pub fn can_edit(self) -> bool {
        matches!(self, Self::Owner | Self::Editor)
    }
}

pub async fn installation_owner_id(state: &AppState) -> AppResult<i64> {
    sqlx::query_scalar("SELECT id FROM users ORDER BY is_admin DESC, id ASC LIMIT 1")
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Unavailable("Kintara does not have an owner account".into()))
}

pub async fn library_role(
    state: &AppState,
    library_id: i64,
    user_id: i64,
) -> AppResult<LibraryRole> {
    let row: Option<(i64, Option<String>)> = sqlx::query_as(
        "SELECT l.owner_id, lm.role
         FROM libraries l
         LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
         WHERE l.id = ?",
    )
    .bind(user_id)
    .bind(library_id)
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some((owner_id, _)) if owner_id == user_id => Ok(LibraryRole::Owner),
        Some((_, Some(role))) if role == "editor" => Ok(LibraryRole::Editor),
        Some((_, Some(role))) if role == "viewer" => Ok(LibraryRole::Viewer),
        _ => Err(AppError::NotFound),
    }
}

pub async fn require_library_owner(
    state: &AppState,
    library_id: i64,
    user_id: i64,
) -> AppResult<()> {
    matches!(
        library_role(state, library_id, user_id).await?,
        LibraryRole::Owner
    )
    .then_some(())
    .ok_or(AppError::NotFound)
}

pub async fn require_library_editor(
    state: &AppState,
    library_id: i64,
    user_id: i64,
) -> AppResult<()> {
    library_role(state, library_id, user_id)
        .await?
        .can_edit()
        .then_some(())
        .ok_or(AppError::NotFound)
}

pub async fn can_view_document(
    state: &AppState,
    document_id: i64,
    user_id: i64,
) -> AppResult<bool> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT EXISTS(
            SELECT 1 FROM documents d
            WHERE d.id = ? AND (
                d.owner_id = ? OR EXISTS (
                    SELECT 1 FROM library_documents ld
                    JOIN libraries l ON l.id = ld.library_id
                    LEFT JOIN library_members lm
                        ON lm.library_id = l.id AND lm.user_id = ?
                    WHERE ld.document_id = d.id
                      AND (l.owner_id = ? OR lm.user_id IS NOT NULL)
                )
            )
        )",
    )
    .bind(document_id)
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?
        != 0)
}

pub async fn can_edit_document(
    state: &AppState,
    document_id: i64,
    user_id: i64,
) -> AppResult<bool> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT EXISTS(
            SELECT 1 FROM documents d
            WHERE d.id = ? AND (
                d.owner_id = ? OR EXISTS (
                    SELECT 1 FROM library_documents ld
                    JOIN libraries l ON l.id = ld.library_id
                    LEFT JOIN library_members lm
                        ON lm.library_id = l.id AND lm.user_id = ?
                    WHERE ld.document_id = d.id
                      AND (l.owner_id = ? OR lm.role = 'editor')
                )
            )
        )",
    )
    .bind(document_id)
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?
        != 0)
}

pub async fn owns_document(state: &AppState, document_id: i64, user_id: i64) -> AppResult<bool> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT EXISTS(SELECT 1 FROM documents WHERE id = ? AND owner_id = ?)",
    )
    .bind(document_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?
        != 0)
}

pub async fn require_document_view(
    state: &AppState,
    document_id: i64,
    user_id: i64,
) -> AppResult<()> {
    can_view_document(state, document_id, user_id)
        .await?
        .then_some(())
        .ok_or(AppError::NotFound)
}

pub async fn require_document_editor(
    state: &AppState,
    document_id: i64,
    user_id: i64,
) -> AppResult<()> {
    can_edit_document(state, document_id, user_id)
        .await?
        .then_some(())
        .ok_or(AppError::NotFound)
}

pub async fn require_document_owner(
    state: &AppState,
    document_id: i64,
    user_id: i64,
) -> AppResult<()> {
    owns_document(state, document_id, user_id)
        .await?
        .then_some(())
        .ok_or(AppError::NotFound)
}
