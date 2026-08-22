import test from "node:test";
import assert from "node:assert/strict";

import type { Document, Page } from "../src/api/types.ts";
import {
  appendDocumentPage,
  documentQueryFor,
  hasMoreDocuments,
  replaceDocumentPage,
} from "../src/lib/document-pagination.ts";

function document(id: number): Document {
  return { id } as Document;
}

function page(ids: number[], total: number, offset: number): Page<Document> {
  return { items: ids.map(document), total, limit: 50, offset };
}

test("later pages append in order and keep a server offset after deduping", () => {
  const first = replaceDocumentPage(page([1, 2, 3], 5, 0));
  const second = appendDocumentPage(first, page([3, 4, 5], 5, 3));

  assert.deepEqual(second.items.map(({ id }) => id), [1, 2, 3, 4, 5]);
  assert.equal(second.nextOffset, 6);
  assert.equal(hasMoreDocuments(second), false);
});

test("a fresh page replaces documents from the previous view", () => {
  const oldView = replaceDocumentPage(page([1, 2], 10, 0));
  const newView = replaceDocumentPage(page([9], 1, 0));

  assert.deepEqual(oldView.items.map(({ id }) => id), [1, 2]);
  assert.deepEqual(newView.items.map(({ id }) => id), [9]);
  assert.equal(newView.total, 1);
});

test("the loaded offset controls whether another page exists", () => {
  assert.equal(hasMoreDocuments(replaceDocumentPage(page([1, 2], 3, 0))), true);
  assert.equal(hasMoreDocuments(replaceDocumentPage(page([1, 2, 3], 3, 0))), false);
});

test("unsearched Recent stays a complete ten-document snapshot", () => {
  const query = documentQueryFor({ type: "recent" }, "", null);
  const recent = replaceDocumentPage(page([1, 2, 3], 150, 0), true);

  assert.equal(query.limit, 10);
  assert.equal(recent.total, 3);
  assert.equal(hasMoreDocuments(recent), false);
});

test("a search from Recent becomes a paged whole-library query", () => {
  const query = documentQueryFor({ type: "recent" }, "  crochet  ", null, 50);

  assert.deepEqual(query, { limit: 50, offset: 50, q: "crochet" });
});
