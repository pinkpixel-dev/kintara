import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = (name: string) =>
  readFile(new URL(`../src/components/${name}`, import.meta.url), "utf8");

test("redundant helper copy stays out of the interface", async () => {
  const sources = await Promise.all([
    component("AiPanel.tsx"),
    component("SettingsModal.tsx"),
    component("OnboardingOverlay.tsx"),
    component("LibrarySharingSection.tsx"),
    component("BulkImportModal.tsx"),
    component("MoveDocumentModal.tsx"),
    component("MarkdownReader.tsx"),
  ]);
  const renderedCopy = sources.join("\n");

  for (const sentence of [
    "Generate a concise summary",
    "Highlights, buttons, and focus rings",
    "People only see this library",
    "A document can belong to more than one library",
    "One at a time, so a large batch",
    "Select text to highlight",
  ]) {
    assert.doesNotMatch(renderedCopy, new RegExp(sentence));
  }
});

test("authentication copy is deployment neutral", async () => {
  const source = await component("AuthGate.tsx");

  assert.doesNotMatch(source, /\bNAS\b/i);
  assert.match(source, /Set the GitHub OAuth environment variables, then restart Kintara\./);
});

test("copy that affects a decision remains visible", async () => {
  const [aiPanel, aiMetadata, aiCover, details, authGate] = await Promise.all([
    component("AiPanel.tsx"),
    component("AiMetadataSuggestions.tsx"),
    component("AiCoverMode.tsx"),
    component("DetailsSidebar.tsx"),
    component("AuthGate.tsx"),
  ]);

  assert.match(aiPanel, /This document already has a summary/);
  assert.match(aiPanel, /Confirm provider request/);
  assert.match(aiMetadata, /Confirm provider request/);
  assert.match(aiMetadata, /document text is sent to your AI provider with storage disabled/);
  assert.match(aiMetadata, /Nothing changes until you apply suggestions and save details/);
  assert.match(aiMetadata, /Metadata suggestions/);
  assert.match(aiMetadata, /Suggest metadata with AI/);
  assert.match(aiCover, /title, author, keywords, and summary are sent/);
  assert.match(aiCover, /custom prompt is sent\. Document metadata and text are not/i);
  assert.match(aiCover, /OpenAI's image endpoint has no retention setting/);
  assert.match(aiCover, /already has a cover\. You can compare\s+before replacing it/);
  assert.match(aiPanel, /<AiCoverMode/);
  assert.match(details, /<AiCoverMode/);
  assert.match(details, />Year<\/label>/);
  assert.match(authGate, /first GitHub account to sign in becomes the owner/);
});
