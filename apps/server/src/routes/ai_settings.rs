//! Per-user AI configuration.
//!
//! Split from the document-facing AI routes when `routes/ai.rs` outgrew the
//! file size limit. Everything here is about what a person has configured;
//! nothing here talks to a provider.

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::ai::Provider;
use crate::ai::credentials::{clean_key, key_context, last_four};
use crate::ai::models;
use crate::current_user::AuthenticatedUser;
use crate::error::{AppError, AppResult};
use crate::secrets;
use crate::state::AppState;

pub(crate) const DEFAULT_OPENAI_MODEL: &str = "gpt-5.6-terra";
pub(crate) const DEFAULT_GOOGLE_MODEL: &str = "gemini-3.7-flash";
pub(crate) const DEFAULT_OPENAI_IMAGE_MODEL: &str = "gpt-image-2";
pub(crate) const DEFAULT_GOOGLE_IMAGE_MODEL: &str = "gemini-3.1-flash-image";
#[derive(Debug, sqlx::FromRow)]
pub(crate) struct SettingsRow {
    pub(crate) enabled: bool,
    pub(crate) provider: Option<String>,
    pub(crate) openai_api_key: Option<String>,
    pub(crate) google_api_key: Option<String>,
    pub(crate) openai_key_hint: Option<String>,
    pub(crate) google_key_hint: Option<String>,
    pub(crate) openai_model: Option<String>,
    pub(crate) google_model: Option<String>,
    pub(crate) openai_reasoning: Option<String>,
    pub(crate) google_thinking: Option<String>,
    pub(crate) temperature: Option<f64>,
    pub(crate) openai_image_model: Option<String>,
    pub(crate) google_image_model: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    set: bool,
    hint: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub(crate) enabled: bool,
    pub(crate) provider: Provider,
    pub(crate) openai_key: KeyStatus,
    pub(crate) google_key: KeyStatus,
    pub(crate) openai_model: String,
    pub(crate) google_model: String,
    pub(crate) openai_reasoning: String,
    pub(crate) google_thinking: String,
    pub(crate) temperature: Option<f64>,
    pub(crate) openai_image_model: String,
    pub(crate) google_image_model: String,
    pub(crate) usage: UsageTotals,
}
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotals {
    input_tokens: i64,
    output_tokens: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettings {
    enabled: bool,
    provider: Provider,
    openai_model: String,
    google_model: String,
    openai_reasoning: String,
    google_thinking: String,
    temperature: Option<f64>,
    openai_image_model: String,
    google_image_model: String,
    openai_api_key: Option<String>,
    google_api_key: Option<String>,
    #[serde(default)]
    remove_openai_key: bool,
    #[serde(default)]
    remove_google_key: bool,
}
pub(crate) async fn load_row(state: &AppState, user_id: i64) -> AppResult<Option<SettingsRow>> {
    Ok(sqlx::query_as(
        "SELECT enabled, provider, openai_api_key, google_api_key,
                openai_key_hint, google_key_hint, openai_model, google_model,
                openai_reasoning, google_thinking, temperature,
                openai_image_model, google_image_model
         FROM user_ai_settings WHERE user_id = ?",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?)
}
async fn usage_totals(state: &AppState, user_id: i64) -> AppResult<UsageTotals> {
    let (input_tokens, output_tokens): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0)
         FROM ai_usage WHERE user_id = ?",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    Ok(UsageTotals {
        input_tokens,
        output_tokens,
    })
}
pub(crate) fn public_settings(row: Option<SettingsRow>, usage: UsageTotals) -> AiSettings {
    let row = row.unwrap_or(SettingsRow {
        enabled: false,
        provider: None,
        openai_api_key: None,
        google_api_key: None,
        openai_key_hint: None,
        google_key_hint: None,
        openai_model: None,
        google_model: None,
        openai_reasoning: None,
        google_thinking: None,
        temperature: None,
        openai_image_model: None,
        google_image_model: None,
    });
    AiSettings {
        enabled: row.enabled,
        provider: if row.provider.as_deref() == Some("google") {
            Provider::Google
        } else {
            Provider::OpenAi
        },
        openai_key: KeyStatus {
            set: row.openai_api_key.is_some(),
            hint: row.openai_key_hint,
        },
        google_key: KeyStatus {
            set: row.google_api_key.is_some(),
            hint: row.google_key_hint,
        },
        openai_model: row
            .openai_model
            .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.into()),
        google_model: row
            .google_model
            .unwrap_or_else(|| DEFAULT_GOOGLE_MODEL.into()),
        openai_reasoning: row.openai_reasoning.unwrap_or_else(|| "medium".into()),
        google_thinking: row.google_thinking.unwrap_or_else(|| "medium".into()),
        temperature: row.temperature,
        openai_image_model: row
            .openai_image_model
            .unwrap_or_else(|| DEFAULT_OPENAI_IMAGE_MODEL.into()),
        google_image_model: row
            .google_image_model
            .unwrap_or_else(|| DEFAULT_GOOGLE_IMAGE_MODEL.into()),
        usage,
    }
}

pub async fn get_settings(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
) -> AppResult<Json<AiSettings>> {
    Ok(Json(public_settings(
        load_row(&state, user_id).await?,
        usage_totals(&state, user_id).await?,
    )))
}

pub async fn update_settings(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
    Json(body): Json<UpdateSettings>,
) -> AppResult<Json<AiSettings>> {
    validate_update(&body)?;
    let existing = load_row(&state, user_id).await?;
    let mut openai_key = existing.as_ref().and_then(|row| row.openai_api_key.clone());
    let mut google_key = existing.as_ref().and_then(|row| row.google_api_key.clone());
    let mut openai_hint = existing
        .as_ref()
        .and_then(|row| row.openai_key_hint.clone());
    let mut google_hint = existing
        .as_ref()
        .and_then(|row| row.google_key_hint.clone());

    if body.remove_openai_key {
        openai_key = None;
        openai_hint = None;
    } else if let Some(key) = clean_key(body.openai_api_key.as_deref()) {
        openai_hint = Some(last_four(key));
        openai_key = Some(secrets::encrypt(
            &state.config,
            key,
            key_context(user_id, Provider::OpenAi).as_bytes(),
        )?);
    }
    if body.remove_google_key {
        google_key = None;
        google_hint = None;
    } else if let Some(key) = clean_key(body.google_api_key.as_deref()) {
        google_hint = Some(last_four(key));
        google_key = Some(secrets::encrypt(
            &state.config,
            key,
            key_context(user_id, Provider::Google).as_bytes(),
        )?);
    }

    if body.enabled
        && match body.provider {
            Provider::OpenAi => openai_key.is_none(),
            Provider::Google => google_key.is_none(),
        }
    {
        return Err(AppError::BadRequest(
            "save an API key for the selected provider before enabling AI".into(),
        ));
    }

    sqlx::query(
        "INSERT INTO user_ai_settings
            (user_id, enabled, provider, openai_api_key, google_api_key,
             openai_key_hint, google_key_hint, openai_model, google_model,
             openai_reasoning, google_thinking, temperature,
             openai_image_model, google_image_model, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
            enabled = excluded.enabled, provider = excluded.provider,
            openai_api_key = excluded.openai_api_key, google_api_key = excluded.google_api_key,
            openai_key_hint = excluded.openai_key_hint, google_key_hint = excluded.google_key_hint,
            openai_model = excluded.openai_model, google_model = excluded.google_model,
            openai_reasoning = excluded.openai_reasoning,
            google_thinking = excluded.google_thinking,
            temperature = excluded.temperature,
            openai_image_model = excluded.openai_image_model,
            google_image_model = excluded.google_image_model,
            updated_at = excluded.updated_at",
    )
    .bind(user_id)
    .bind(body.enabled)
    .bind(body.provider.as_str())
    .bind(openai_key)
    .bind(google_key)
    .bind(openai_hint)
    .bind(google_hint)
    .bind(&body.openai_model)
    .bind(&body.google_model)
    .bind(&body.openai_reasoning)
    .bind(&body.google_thinking)
    .bind(body.temperature)
    .bind(&body.openai_image_model)
    .bind(&body.google_image_model)
    .execute(&state.db)
    .await?;

    get_settings(State(state), AuthenticatedUser(user_id)).await
}

fn validate_update(body: &UpdateSettings) -> AppResult<()> {
    if !models::validate_model(Provider::OpenAi, &body.openai_model)
        || !models::validate_model(Provider::Google, &body.google_model)
    {
        return Err(AppError::BadRequest("select a supported model".into()));
    }
    if !models::validate_reasoning(Provider::OpenAi, &body.openai_model, &body.openai_reasoning)
        || !models::validate_reasoning(Provider::Google, &body.google_model, &body.google_thinking)
    {
        return Err(AppError::BadRequest(
            "the selected reasoning level is not supported by that model".into(),
        ));
    }
    if !models::validate_image_model(Provider::OpenAi, &body.openai_image_model)
        || !models::validate_image_model(Provider::Google, &body.google_image_model)
    {
        return Err(AppError::BadRequest(
            "select a supported image model".into(),
        ));
    }
    if body.temperature.is_some() && body.openai_reasoning != "none" {
        return Err(AppError::BadRequest(
            "temperature is available only when OpenAI reasoning is off".into(),
        ));
    }
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new().route("/settings", get(get_settings).put(update_settings))
}
