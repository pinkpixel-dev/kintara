use serde_json::{Value, json};

use crate::error::{AppError, AppResult};

use super::Provider;

const MAX_PROVIDER_RESPONSE: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct GenerateRequest<'a> {
    pub provider: Provider,
    pub api_key: &'a str,
    pub model: &'a str,
    pub instructions: &'a str,
    pub input: &'a str,
    pub reasoning: Option<&'a str>,
    pub temperature: Option<f64>,
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
    let mut body = json!({
        "model": request.model,
        "instructions": request.instructions,
        "input": request.input,
        "store": false,
        "max_output_tokens": 1200
    });
    if let Some(reasoning) = request.reasoning {
        body["reasoning"] = json!({ "effort": reasoning });
    }
    if request.reasoning == Some("none")
        && let Some(temperature) = request.temperature
    {
        body["temperature"] = json!(temperature);
    }

    let value = send_json(
        client
            .post("https://api.openai.com/v1/responses")
            .bearer_auth(request.api_key)
            .json(&body),
    )
    .await?;
    parse_openai(&value)
}

async fn google(
    client: &reqwest::Client,
    request: GenerateRequest<'_>,
) -> AppResult<GenerateResult> {
    let mut generation_config = json!({ "max_output_tokens": 1200 });
    if let Some(thinking) = request.reasoning {
        generation_config["thinking_level"] = json!(thinking);
    }
    let body = json!({
        "model": request.model,
        "input": request.input,
        "system_instruction": request.instructions,
        "store": false,
        "generation_config": generation_config
    });
    let value = send_json(
        client
            .post("https://generativelanguage.googleapis.com/v1beta/interactions")
            .header("x-goog-api-key", request.api_key)
            .json(&body),
    )
    .await?;
    parse_google(&value)
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
    if !status.is_success() {
        return Err(AppError::Unavailable(format!(
            "the provider returned HTTP {}",
            status.as_u16()
        )));
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
    serde_json::from_slice(&bytes)
        .map_err(|err| AppError::Unavailable(format!("provider returned invalid JSON: {err}")))
}

fn parse_openai(value: &Value) -> AppResult<GenerateResult> {
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
}
