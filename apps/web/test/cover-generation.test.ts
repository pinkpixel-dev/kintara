import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CUSTOM_COVER_PROMPT_CHARS,
  canSubmitCustomCoverPrompt,
  coverPromptLength,
  limitCoverPrompt,
} from "../src/lib/cover-generation.ts";

test("custom cover prompts require visible content", () => {
  assert.equal(canSubmitCustomCoverPrompt(""), false);
  assert.equal(canSubmitCustomCoverPrompt("   \n"), false);
  assert.equal(canSubmitCustomCoverPrompt("A cut-paper forest"), true);
});

test("custom cover prompt limits count Unicode characters", () => {
  assert.equal(coverPromptLength("moon 🌙"), 6);
  assert.equal(canSubmitCustomCoverPrompt("é".repeat(MAX_CUSTOM_COVER_PROMPT_CHARS)), true);
  assert.equal(canSubmitCustomCoverPrompt("🌙".repeat(MAX_CUSTOM_COVER_PROMPT_CHARS + 1)), false);
  assert.equal(
    limitCoverPrompt("🌙".repeat(MAX_CUSTOM_COVER_PROMPT_CHARS + 1)),
    "🌙".repeat(MAX_CUSTOM_COVER_PROMPT_CHARS),
  );
});
