use serde_json::{Value, json};

use crate::error::{AppError, AppResult};

use super::Provider;

const MAX_PROVIDER_RESPONSE: usize = 2 * 1024 * 1024;

/// A strict JSON schema the provider must answer with.
///
/// Each caller owns its own shape — grounded document answers and rewritten
/// search filters need different fields — so the schema arrives with the
/// request rather than living here as a flag.
#[derive(Debug, Clone)]
pub struct JsonSchema<'a> {
    pub name: &'a str,
    pub schema: Value,
}

#[derive(Debug, Clone)]
pub struct GenerateRequest<'a> {
    pub provider: Provider,
    pub api_key: &'a str,
    pub model: &'a str,
    pub instructions: &'a str,
    pub input: &'a str,
    pub reasoning: Option<&'a str>,
    pub temperature: Option<f64>,
    pub response_schema: Option<JsonSchema<'a>>,
    /// Output ceiling for this call.
    ///
    /// Per request rather than one constant, because the callers need wildly
    /// different room: a summary is prose, a passage list is eight quotes. On
    /// OpenAI this budget also covers reasoning tokens, so a small model at a
    /// high reasoning level can spend most of it before writing anything —
    /// which truncates structured output mid-string rather than failing loudly.
    pub max_output_tokens: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub struct GenerateResult {
    pub text: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
}

pub async fn generate(
    client: &reqwest::Client,
    request: GenerateRequest<'_>,
) -> AppResult<GenerateResult> {
    match request.provider {
        Provider::OpenAi => openai(client, request).await,
        Provider::Google => google(client, request).await,
    }
}

async fn openai(
    client: &reqwest::Client,
    request: GenerateRequest<'_>,
) -> AppResult<GenerateResult> {
    let body = openai_body(&request);
    let value = send_json(
        client
            .post("https://api.openai.com/v1/responses")
            .bearer_auth(request.api_key)
            .json(&body),
    )
    .await?;
    parse_openai(&value)
}

fn openai_body(request: &GenerateRequest<'_>) -> Value {
    let mut body = json!({
        "model": request.model,
        "instructions": request.instructions,
        "input": request.input,
        "store": false,
        "max_output_tokens": request.max_output_tokens
    });
    if let Some(schema) = &request.response_schema {
        body["text"] = json!({
            "format": {
                "type": "json_schema",
                "name": schema.name,
                "strict": true,
                "schema": schema.schema
            }
        });
    }
    if let Some(reasoning) = request.reasoning {
        body["reasoning"] = json!({ "effort": reasoning });
    }
    if request.reasoning == Some("none")
        && let Some(temperature) = request.temperature
    {
        body["temperature"] = json!(temperature);
    }

    body
}

async fn google(
    client: &reqwest::Client,
    request: GenerateRequest<'_>,
) -> AppResult<GenerateResult> {
    let body = google_body(&request);
    let value = send_json(
        client
            .post("https://generativelanguage.googleapis.com/v1beta/interactions")
            .header("x-goog-api-key", request.api_key)
            .json(&body),
    )
    .await?;
    parse_google(&value)
}

fn google_body(request: &GenerateRequest<'_>) -> Value {
    let mut generation_config = json!({ "max_output_tokens": request.max_output_tokens });
    if let Some(thinking) = request.reasoning {
        generation_config["thinking_level"] = json!(thinking);
    }
    let mut body = json!({
        "model": request.model,
        "input": request.input,
        "system_instruction": request.instructions,
        "store": false,
        "generation_config": generation_config
    });
    if let Some(schema) = &request.response_schema {
        body["response_format"] = json!({
            "type": "text",
            "mime_type": "application/json",
            "schema": schema.schema
        });
    }
    body
}

async fn send_json(builder: reqwest::RequestBuilder) -> AppResult<Value> {
    let response = builder
        .send()
        .await
        .map_err(|err| AppError::Unavailable(format!("AI provider could not be reached: {err}")))?;
    let status = response.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(AppError::BadRequest(
            "the provider rejected this API key".into(),
        ));
    }
    if status.as_u16() == 429 {
        return Err(AppError::Unavailable(
            "the provider rate limit was reached; try again shortly".into(),
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_PROVIDER_RESPONSE as u64)
    {
        return Err(AppError::Unavailable(
            "the provider response was too large".into(),
        ));
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|err| {
        AppError::Unavailable(format!("provider response could not be read: {err}"))
    })? {
        if bytes.len().saturating_add(chunk.len()) > MAX_PROVIDER_RESPONSE {
            return Err(AppError::Unavailable(
                "the provider response was too large".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        let detail = provider_error_detail(&bytes)
            .map(|message| format!(": {message}"))
            .unwrap_or_default();
        return Err(AppError::Unavailable(format!(
            "the provider returned HTTP {}{detail}",
            status.as_u16()
        )));
    }
    serde_json::from_slice(&bytes)
        .map_err(|err| AppError::Unavailable(format!("provider returned invalid JSON: {err}")))
}

/// Extracts only the provider's public error message. The rest of the body is
/// discarded because it can contain request metadata that should not be
/// reflected into the browser.
fn provider_error_detail(bytes: &[u8]) -> Option<String> {
    let value: Value = serde_json::from_slice(bytes).ok()?;
    let message = value["error"]["message"]
        .as_str()?
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if message.is_empty() {
        return None;
    }
    Some(message.chars().take(320).collect())
}

fn parse_openai(value: &Value) -> AppResult<GenerateResult> {
    // Reported rather than left to surface as a confusing parse failure further
    // up: an answer stopped at the ceiling is usually valid JSON with its last
    // string unterminated.
    if value["status"] == "incomplete" {
        let reason = value["incomplete_details"]["reason"].as_str().unwrap_or("");
        if reason == "max_output_tokens" {
            return Err(AppError::Unavailable(
                "the model reached its output limit before it finished; try a shorter request or a lower reasoning level".into(),
            ));
        }
    }
    let text = value["output"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["type"] == "message")
        .filter_map(|item| item["content"].as_array())
        .flatten()
        .filter(|content| content["type"] == "output_text")
        .filter_map(|content| content["text"].as_str())
        .collect::<Vec<_>>()
        .join("");
    if text.trim().is_empty() {
        return Err(AppError::Unavailable(
            "OpenAI returned no text output".into(),
        ));
    }
    Ok(GenerateResult {
        text,
        input_tokens: value["usage"]["input_tokens"].as_i64(),
        output_tokens: value["usage"]["output_tokens"].as_i64(),
    })
}

fn parse_google(value: &Value) -> AppResult<GenerateResult> {
    let text = value["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|step| step["type"] == "model_output")
        .filter_map(|step| step["content"].as_array())
        .flatten()
        .filter(|content| content["type"] == "text")
        .filter_map(|content| content["text"].as_str())
        .collect::<Vec<_>>()
        .join("");
    if text.trim().is_empty() {
        return Err(AppError::Unavailable(
            "Google returned no text output".into(),
        ));
    }
    Ok(GenerateResult {
        text,
        input_tokens: value["usage"]["total_input_tokens"].as_i64(),
        output_tokens: value["usage"]["total_output_tokens"].as_i64(),
    })
}

/// Turns a failure to read a structured reply into something actionable.
///
/// A truncated answer and a malformed one need different advice, and serde can
/// tell them apart: a cut-off reply ends the input early, which classifies as
/// EOF. Without this the reader sees "EOF while parsing a string at line 1
/// column 258", which says nothing about what to do next.
pub fn structured_error(err: &serde_json::Error, what: &str) -> AppError {
    if err.classify() == serde_json::error::Category::Eof {
        AppError::Unavailable(format!(
            "the model's {what} was cut off before it finished; try a shorter request or a lower reasoning level"
        ))
    } else {
        AppError::Unavailable(format!("provider returned an invalid {what}: {err}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captured_openai_response_parses_text_and_usage() {
        let value = json!({
            "output": [{"type":"message","content":[{"type":"output_text","text":"A summary."}]}],
            "usage": {"input_tokens": 42, "output_tokens": 7}
        });
        assert_eq!(
            parse_openai(&value).unwrap(),
            GenerateResult {
                text: "A summary.".into(),
                input_tokens: Some(42),
                output_tokens: Some(7)
            }
        );
    }

    #[test]
    fn captured_google_interaction_parses_model_output_and_usage() {
        let value = json!({
            "steps": [{"type":"model_output","content":[{"type":"text","text":"A summary."}]}],
            "usage": {"total_input_tokens": 42, "total_output_tokens": 7}
        });
        assert_eq!(parse_google(&value).unwrap().text, "A summary.");
    }

    #[test]
    fn provider_errors_expose_only_a_short_normalized_message() {
        let body = br#"{"error":{"code":400,"message":"  Invalid   thinking level.\nTry low.  ","request":{"input":"private document"}}}"#;
        assert_eq!(
            provider_error_detail(body).as_deref(),
            Some("Invalid thinking level. Try low.")
        );
        assert_eq!(provider_error_detail(b"not json"), None);

        let long = json!({ "error": { "message": "x".repeat(400) } });
        assert_eq!(
            provider_error_detail(long.to_string().as_bytes())
                .unwrap()
                .chars()
                .count(),
            320
        );
    }

    #[test]
    fn structured_requests_disable_provider_storage_and_use_each_api_schema() {
        let request = GenerateRequest {
            provider: Provider::OpenAi,
            api_key: "secret",
            model: "model",
            instructions: "instructions",
            input: "input",
            reasoning: Some("medium"),
            temperature: None,
            response_schema: Some(JsonSchema {
                name: "example",
                schema: json!({ "type": "object" }),
            }),
            max_output_tokens: 4000,
        };
        let openai = openai_body(&request);
        assert_eq!(openai["store"], false);
        assert_eq!(openai["text"]["format"]["type"], "json_schema");
        assert_eq!(openai["text"]["format"]["name"], "example");

        let google = google_body(&request);
        assert_eq!(google["store"], false);
        assert_eq!(google["response_format"]["type"], "text");
        assert_eq!(google["response_format"]["mime_type"], "application/json");
        assert!(google.get("temperature").is_none());
        assert_eq!(openai["max_output_tokens"], 4000);
        assert_eq!(google["generation_config"]["max_output_tokens"], 4000);
    }

    #[test]
    fn an_answer_stopped_at_the_output_limit_says_so() {
        let value = json!({
            "status": "incomplete",
            "incomplete_details": { "reason": "max_output_tokens" },
            "output": []
        });
        let message = parse_openai(&value).unwrap_err().to_string();
        assert!(message.contains("output limit"), "{message}");
    }

    #[test]
    fn a_cut_off_reply_reads_differently_from_a_malformed_one() {
        let truncated =
            serde_json::from_str::<serde_json::Value>(r#"{"answer":"half"#).unwrap_err();
        assert!(
            structured_error(&truncated, "answer")
                .to_string()
                .contains("cut off")
        );

        let malformed = serde_json::from_str::<serde_json::Value>("{oops}").unwrap_err();
        assert!(
            structured_error(&malformed, "answer")
                .to_string()
                .contains("invalid answer")
        );
    }
}
