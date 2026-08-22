export const MAX_CUSTOM_COVER_PROMPT_CHARS = 1_000;

/** Counts visible Unicode code points rather than UTF-16 storage units. */
export function coverPromptLength(value: string) {
  return Array.from(value).length;
}

export function limitCoverPrompt(value: string) {
  return Array.from(value).slice(0, MAX_CUSTOM_COVER_PROMPT_CHARS).join("");
}

export function canSubmitCustomCoverPrompt(value: string) {
  const length = coverPromptLength(value);
  return value.trim().length > 0 && length <= MAX_CUSTOM_COVER_PROMPT_CHARS;
}
