import test from "node:test";
import assert from "node:assert/strict";

import type { Document, MetadataSuggestionCandidate } from "../src/api/index.ts";
import {
  applySelectedMetadata,
  defaultSelectedFields,
  missingSuggestionLabels,
  reviewableSuggestions,
} from "../src/lib/metadata-suggestions.ts";

const document: Document = {
  id: 8,
  title: "scan-008.pdf",
  author: null,
  documentType: "pdf",
  fileSize: 1200,
  summary: null,
  keywords: "existing",
  doi: null,
  isbn: null,
  pageCount: 12,
  year: null,
  createdAt: "2026-08-22T12:00:00Z",
  modifiedAt: "2026-08-22T12:00:00Z",
  readingProgress: 0,
  isFavorite: false,
  hasThumbnail: false,
  coverVersion: null,
};

const candidate: MetadataSuggestionCandidate = {
  title: "A Clear Title",
  author: "Ada Example",
  summary: "A useful summary.",
  keywords: "new, useful",
  doi: null,
  isbn: "9781234567890",
  year: 2024,
  provider: "openai",
  model: "gpt-5-mini",
};

test("blank fields are selected while populated metadata is protected", () => {
  const selected = defaultSelectedFields(document, candidate);

  assert.deepEqual([...selected], ["author", "summary", "isbn", "year"]);
  assert.equal(selected.has("title"), false);
  assert.equal(selected.has("keywords"), false);
});

test("null and identical suggestions are not reviewable", () => {
  const same = { ...candidate, title: document.title, keywords: " existing " };
  const fields = reviewableSuggestions(document, same).map(({ field }) => field);

  assert.equal(fields.includes("title"), false);
  assert.equal(fields.includes("keywords"), false);
  assert.equal(fields.includes("doi"), false);
  assert.deepEqual(missingSuggestionLabels(same), ["doi"]);
});

test("only selected non-null suggestions are applied without mutating the source", () => {
  const selected = new Set(["author", "year", "doi"] as const);
  const next = applySelectedMetadata(document, candidate, selected);

  assert.notEqual(next, document);
  assert.equal(document.author, null);
  assert.equal(document.year, null);
  assert.equal(next.author, "Ada Example");
  assert.equal(next.year, 2024);
  assert.equal(next.doi, null);
  assert.equal(next.title, document.title);
  assert.equal(next.keywords, document.keywords);
});

test("uncertain author and publication year remain blank", () => {
  const uncertain = { ...candidate, author: null, year: null };
  const next = applySelectedMetadata(
    document,
    uncertain,
    new Set(["author", "year"] as const),
  );

  assert.equal(next.author, null);
  assert.equal(next.year, null);
  assert.deepEqual(missingSuggestionLabels(uncertain), ["author", "doi", "publication year"]);
});
