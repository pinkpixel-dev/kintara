use serde::Serialize;

use super::Provider;

pub const OPENAI_MODELS: &[&str] = &[
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.2",
    "gpt-5.1",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
];

pub const GOOGLE_MODELS: &[&str] = &[
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
];

/// Image models, from the lists approved in `ROADMAP.md`.
pub const OPENAI_IMAGE_MODELS: &[&str] = &[
    "gpt-image-2",
    "gpt-image-1.5",
    "gpt-image-1-mini",
    "gpt-image-1",
];

pub const GOOGLE_IMAGE_MODELS: &[&str] = &[
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-lite-image",
    "gemini-3-pro-image",
    "gemini-2.5-flash-image",
];

const OPENAI_56_REASONING: &[&str] = &["none", "low", "medium", "high", "xhigh", "max"];
const OPENAI_52_55_REASONING: &[&str] = &["none", "low", "medium", "high", "xhigh"];
const OPENAI_51_REASONING: &[&str] = &["none", "low", "medium", "high"];
const OPENAI_5_REASONING: &[&str] = &["minimal", "low", "medium", "high"];
const GOOGLE_ALL_THINKING: &[&str] = &["minimal", "low", "medium", "high"];
const GOOGLE_NO_MINIMAL_THINKING: &[&str] = &["low", "medium", "high"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapability {
    pub id: &'static str,
    pub reasoning: &'static [&'static str],
    pub supports_temperature: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub openai: Vec<ModelCapability>,
    pub google: Vec<ModelCapability>,
    pub openai_image: &'static [&'static str],
    pub google_image: &'static [&'static str],
}

pub fn catalog() -> ModelCatalog {
    ModelCatalog {
        openai: OPENAI_MODELS
            .iter()
            .map(|id| ModelCapability {
                id,
                reasoning: openai_reasoning(id),
                // OpenAI accepts sampling controls only when reasoning is off;
                // the UI also enforces that dependency.
                supports_temperature: openai_reasoning(id).contains(&"none"),
            })
            .collect(),
        google: GOOGLE_MODELS
            .iter()
            .map(|id| ModelCapability {
                id,
                reasoning: google_thinking(id),
                // The Interactions schema has no temperature field.
                supports_temperature: false,
            })
            .collect(),
        openai_image: OPENAI_IMAGE_MODELS,
        google_image: GOOGLE_IMAGE_MODELS,
    }
}

pub fn validate_image_model(provider: Provider, model: &str) -> bool {
    match provider {
        Provider::OpenAi => OPENAI_IMAGE_MODELS.contains(&model),
        Provider::Google => GOOGLE_IMAGE_MODELS.contains(&model),
    }
}

pub fn validate_model(provider: Provider, model: &str) -> bool {
    match provider {
        Provider::OpenAi => OPENAI_MODELS.contains(&model),
        Provider::Google => GOOGLE_MODELS.contains(&model),
    }
}

pub fn openai_reasoning(model: &str) -> &'static [&'static str] {
    match model {
        "gpt-5.6-sol" | "gpt-5.6-terra" | "gpt-5.6-luna" => OPENAI_56_REASONING,
        "gpt-5.5" | "gpt-5.4" | "gpt-5.4-mini" | "gpt-5.4-nano" | "gpt-5.2" => {
            OPENAI_52_55_REASONING
        }
        "gpt-5.1" => OPENAI_51_REASONING,
        "gpt-5" | "gpt-5-mini" | "gpt-5-nano" => OPENAI_5_REASONING,
        _ => &[],
    }
}

pub fn google_thinking(model: &str) -> &'static [&'static str] {
    match model {
        "gemini-3.7-flash" | "gemini-3.1-pro-preview" => GOOGLE_NO_MINIMAL_THINKING,
        _ => GOOGLE_ALL_THINKING,
    }
}

pub fn validate_reasoning(provider: Provider, model: &str, value: &str) -> bool {
    match provider {
        Provider::OpenAi => openai_reasoning(model).contains(&value),
        Provider::Google => google_thinking(model).contains(&value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn older_openai_models_never_offer_unsupported_none_or_xhigh() {
        assert!(!openai_reasoning("gpt-5").contains(&"none"));
        assert!(!openai_reasoning("gpt-5.1").contains(&"xhigh"));
        assert_eq!(
            openai_reasoning("gpt-5.6-terra"),
            ["none", "low", "medium", "high", "xhigh", "max"]
        );
        assert!(!openai_reasoning("gpt-5.4").contains(&"minimal"));
    }

    #[test]
    fn image_models_are_validated_against_their_own_provider() {
        assert!(validate_image_model(Provider::OpenAi, "gpt-image-2"));
        assert!(validate_image_model(
            Provider::Google,
            "gemini-3.1-flash-image"
        ));
        // A text model is not an image model, and neither crosses providers.
        assert!(!validate_image_model(Provider::OpenAi, "gpt-5.6-terra"));
        assert!(!validate_image_model(
            Provider::OpenAi,
            "gemini-3.1-flash-image"
        ));
        assert!(!validate_image_model(Provider::Google, "gpt-image-2"));
    }

    #[test]
    fn google_thinking_levels_follow_each_models_documented_capabilities() {
        assert!(!google_thinking("gemini-3.7-flash").contains(&"minimal"));
        assert!(!google_thinking("gemini-3.1-pro-preview").contains(&"minimal"));
        assert!(google_thinking("gemini-3.1-flash-lite").contains(&"minimal"));
    }

    #[test]
    fn unavailable_gemini_25_text_models_are_not_selectable() {
        assert!(!validate_model(Provider::Google, "gemini-2.5-pro"));
        assert!(!validate_model(Provider::Google, "gemini-2.5-flash"));
        assert!(!validate_model(Provider::Google, "gemini-2.5-flash-lite"));
    }
}
