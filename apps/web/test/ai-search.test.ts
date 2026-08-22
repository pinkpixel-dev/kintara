import test from "node:test";
import assert from "node:assert/strict";
import {
  describeInterpretation,
  extraFiltersFor,
  scopeFor,
  viewForInterpretation,
} from "../src/lib/ai-search.ts";
import type { AiSearchInterpretation } from "../src/api/ai.ts";

const interpretation = (
  overrides: Partial<AiSearchInterpretation> = {},
): AiSearchInterpretation => ({
  terms: "dragon",
  libraryId: null,
  libraryName: null,
  collectionId: null,
  collectionName: null,
  tagId: null,
  tagName: null,
  favorite: false,
  sort: "recent",
  explanation: "Looking for dragon patterns.",
  ...overrides,
});

test("the scope hint follows the view the search started in", () => {
  assert.deepEqual(scopeFor({ type: "library", id: 3 }), { libraryId: 3 });
  assert.deepEqual(scopeFor({ type: "collection", id: 7 }), { collectionId: 7 });
  assert.deepEqual(scopeFor({ type: "recent" }), {});
  assert.deepEqual(scopeFor({ type: "favorites" }), {});
  // A library view with no id cannot be scoped to anything.
  assert.deepEqual(scopeFor({ type: "library" }), {});
});

test("a collection wins over the library that contains it", () => {
  const result = interpretation({ libraryId: 3, collectionId: 7 });
  assert.deepEqual(viewForInterpretation(result), { type: "collection", id: 7 });
});

test("favorites becomes a view only when nothing narrower was named", () => {
  assert.deepEqual(viewForInterpretation(interpretation({ favorite: true })), {
    type: "favorites",
  });
  assert.deepEqual(
    viewForInterpretation(interpretation({ favorite: true, libraryId: 3 })),
    { type: "library", id: 3 },
  );
  assert.deepEqual(viewForInterpretation(interpretation()), { type: "all" });
});

test("favourites survives as a filter when a library took the view", () => {
  const result = interpretation({ favorite: true, libraryId: 3 });
  assert.deepEqual(extraFiltersFor(result), { favorite: true });
});

test("only filters the sidebar cannot express are layered on", () => {
  assert.deepEqual(extraFiltersFor(interpretation()), {});
  assert.deepEqual(extraFiltersFor(interpretation({ tagId: 12, sort: "year" })), {
    tagId: 12,
    sort: "year",
  });
  // "recent" is the list's own default, so sending it would be noise.
  assert.deepEqual(extraFiltersFor(interpretation({ sort: "recent" })), {});
});

test("every applied filter is named for the reader", () => {
  const result = interpretation({
    libraryId: 3,
    libraryName: "Patterns",
    tagId: 12,
    tagName: "crochet",
    favorite: true,
    sort: "title",
  });
  assert.deepEqual(describeInterpretation(result), [
    "“dragon”",
    "in Patterns",
    "tagged crochet",
    "Favorites",
    "by title",
  ]);
});

test("an unscoped search says so rather than saying nothing", () => {
  assert.deepEqual(describeInterpretation(interpretation({ terms: "" })), ["everywhere"]);
});
