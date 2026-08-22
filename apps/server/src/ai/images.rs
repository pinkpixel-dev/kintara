//! Image generation, for document covers.
//!
//! A separate module from `providers` because the two providers diverge here in
//! a way the text path does not. Google generates images through the same
//! Interactions endpoint Kintara already uses, so `store: false` applies exactly
//! as it does everywhere else. OpenAI uses a dedicated Images endpoint that has
//! no `store` parameter at all.
//!
//! That gap cannot be closed from here, so it is disclosed instead: `stored_by
//! _provider` travels back with the result and the confirmation dialog says so
//! before anything is sent. See the amended retention decision in `MEMORY.md`.

use serde_json::{Value, json};

use crate::error::{AppError, AppResult};

use super::Provider;

/// Images are far larger than text answers, and arrive base64-encoded.
const MAX_IMAGE_RESPONSE: usize = 16 * 1024 * 1024;

/// Image prompts are documented as taking up to two minutes on OpenAI, well
/// past the 90 seconds the shared client allows for text.
const IMAGE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

/// Portrait, because a cover sits in a grid of book spines. OpenAI takes exact
/// pixels; Google takes a ratio and a tier, where 2:3 at 1K is 848x1264.
const OPENAI_SIZE: &str = "1024x1536";
const GOOGLE_ASPECT_RATIO: &str = "2:3";
const GOOGLE_IMAGE_SIZE: &str = "1K";

#[derive(Debug, Clone)]
pub struct ImageRequest<'a> {
    pub provider: Provider,
    pub api_key: &'a str,
    pub model: &'a str,
    pub prompt: &'a str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct GeneratedImage {
    /// Base64, exactly as the provider returned it. Decoded once, at the edge
    /// that writes the file.
    pub base64: String,
    pub mime_type: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    /// False when the request could be sent with retention disabled.
    pub stored_by_provider: bool,
}

pub async fn generate(
    client: &reqwest::Client,
    request: ImageRequest<'_>,
) -> AppResult<GeneratedImage> {
    match request.provider {
        Provider::OpenAi => openai(client, request).await,
        Provider::Google => google(client, request).await,
    }
}

async fn openai(client: &reqwest::Client, request: ImageRequest<'_>) -> AppResult<GeneratedImage> {
    let value = send(
        client
            .post("https://api.openai.com/v1/images/generations")
            .bearer_auth(request.api_key)
            .timeout(IMAGE_TIMEOUT)
            .json(&openai_body(&request)),
    )
    .await?;
    parse_openai(&value)
}

fn openai_body(request: &ImageRequest<'_>) -> Value {
    json!({
        "model": request.model,
        "prompt": request.prompt,
        "size": OPENAI_SIZE,
        // A cover is displayed as a grid tile. Low quality is a fraction of the
        // cost and the difference is not visible at that size.
        "quality": "low",
        "output_format": "jpeg",
        "n": 1
    })
}

async fn google(client: &reqwest::Client, request: ImageRequest<'_>) -> AppResult<GeneratedImage> {
    let value = send(
        client
            .post("https://generativelanguage.googleapis.com/v1beta/interactions")
            .header("x-goog-api-key", request.api_key)
            .timeout(IMAGE_TIMEOUT)
            .json(&google_body(&request)),
    )
    .await?;
    parse_google(&value)
}

fn google_body(request: &ImageRequest<'_>) -> Value {
    json!({
        "model": request.model,
        "input": request.prompt,
        "store": false,
        "response_format": {
            "type": "image",
            "aspect_ratio": GOOGLE_ASPECT_RATIO,
            "image_size": GOOGLE_IMAGE_SIZE
        }
    })
}

async fn send(builder: reqwest::RequestBuilder) -> AppResult<Value> {
    let response = builder.send().await.map_err(|err| {
        AppError::Unavailable(format!("the image provider could not be reached: {err}"))
    })?;
    let status = response.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(AppError::BadRequest(
            "the provider rejected this API key for image generation; GPT Image models also require organization verification".into(),
        ));
    }
    if status.as_u16() == 429 {
        return Err(AppError::Unavailable(
            "the provider rate limit was reached; try again shortly".into(),
        ));
    }
    if !status.is_success() {
        // Moderation refusals are the one provider error worth naming, because
        // the fix is to change the document's metadata rather than to retry.
        let body = response.text().await.unwrap_or_default();
        if body.contains("moderation_blocked") {
            return Err(AppError::BadRequest(
                "the provider's content filter refused this cover prompt".into(),
            ));
        }
        return Err(AppError::Unavailable(format!(
            "the image provider returned HTTP {}",
            status.as_u16()
        )));
    }

    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| AppError::Unavailable(format!("image response could not be read: {err}")))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_IMAGE_RESPONSE {
            return Err(AppError::Unavailable(
                "the generated image was too large".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|err| AppError::Unavailable(format!("provider returned invalid JSON: {err}")))
}

fn parse_openai(value: &Value) -> AppResult<GeneratedImage> {
    let base64 = value["data"][0]["b64_json"]
        .as_str()
        .filter(|data| !data.is_empty())
        .ok_or_else(|| AppError::Unavailable("OpenAI returned no image".into()))?;
    Ok(GeneratedImage {
        base64: base64.to_string(),
        // Requested as JPEG above; the endpoint does not echo the format back.
        mime_type: "image/jpeg".into(),
        input_tokens: value["usage"]["input_tokens"].as_i64(),
        output_tokens: value["usage"]["output_tokens"].as_i64(),
        stored_by_provider: true,
    })
}

fn parse_google(value: &Value) -> AppResult<GeneratedImage> {
    let image = value["steps"]
        .as_array()
        .into_iter()
        .flatten()
        // `thought` steps also carry interim images on Gemini 3 image models;
        // only the finished output is wanted.
        .filter(|step| step["type"] == "model_output")
        .filter_map(|step| step["content"].as_array())
        .flatten()
        .find(|content| content["type"] == "image" && content["data"].is_string())
        .ok_or_else(|| AppError::Unavailable("Google returned no image".into()))?;

    Ok(GeneratedImage {
        base64: image["data"].as_str().unwrap_or_default().to_string(),
        mime_type: image["mime_type"]
            .as_str()
            .unwrap_or("image/png")
            .to_string(),
        input_tokens: value["usage"]["total_input_tokens"].as_i64(),
        output_tokens: value["usage"]["total_output_tokens"].as_i64(),
        stored_by_provider: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(provider: Provider) -> ImageRequest<'static> {
        ImageRequest {
            provider,
            api_key: "secret",
            model: "model",
            prompt: "a cover",
        }
    }

    #[test]
    fn google_image_requests_still_disable_provider_storage() {
        let body = google_body(&request(Provider::Google));
        assert_eq!(body["store"], false);
        assert_eq!(body["response_format"]["aspect_ratio"], "2:3");
        assert_eq!(body["response_format"]["image_size"], "1K");
    }

    #[test]
    fn openai_image_requests_ask_for_a_portrait_jpeg() {
        // The Images endpoint has no `store` field to set, which is exactly the
        // gap the confirmation dialog discloses.
        let body = openai_body(&request(Provider::OpenAi));
        assert_eq!(body["size"], "1024x1536");
        assert_eq!(body["output_format"], "jpeg");
        assert_eq!(body["n"], 1);
        assert!(body.get("store").is_none());
    }

    #[test]
    fn each_providers_response_shape_yields_the_image_and_its_retention() {
        let openai = parse_openai(&json!({
            "data": [{ "b64_json": "AAAA" }],
            "usage": { "input_tokens": 12, "output_tokens": 300 }
        }))
        .unwrap();
        assert_eq!(openai.base64, "AAAA");
        assert_eq!(openai.mime_type, "image/jpeg");
        assert!(openai.stored_by_provider);

        let google = parse_google(&json!({
            "steps": [
                { "type": "thought", "summary": [{ "type": "image", "data": "DRAFT" }] },
                { "type": "model_output", "content": [
                    { "type": "text", "text": "Here is a cover." },
                    { "type": "image", "data": "BBBB", "mime_type": "image/png" }
                ]}
            ],
            "usage": { "total_input_tokens": 9, "total_output_tokens": 1120 }
        }))
        .unwrap();
        // The interim thought image must not be mistaken for the result.
        assert_eq!(google.base64, "BBBB");
        assert_eq!(google.mime_type, "image/png");
        assert!(!google.stored_by_provider);
    }

    #[test]
    fn a_response_carrying_no_image_is_an_error_rather_than_an_empty_cover() {
        assert!(parse_openai(&json!({ "data": [{ "b64_json": "" }] })).is_err());
        assert!(parse_google(&json!({ "steps": [] })).is_err());
        assert!(
            parse_google(&json!({
                "steps": [{ "type": "model_output", "content": [{ "type": "text", "text": "no" }] }]
            }))
            .is_err()
        );
    }
}
