/**
 * What the empty grid says, and why.
 *
 * Run with `npm run test --workspace apps/web`. Node strips the types itself,
 * so this needs no test framework and no new dependency.
 *
 * The cases matter because the previous single message could not tell a search
 * that matched nothing from a library with nothing in it, and on a phone the
 * scope chip that would have explained the difference is inside the drawer.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { emptyReasonFor } from "../src/lib/empty-reason.ts";

test("a scoped search names the scope and offers to widen", () => {
  const reason = emptyReasonFor("kubernetes", { type: "library", id: 3 }, "Infrastructure");
  assert.deepEqual(reason, {
    kind: "search",
    query: "kubernetes",
    scopeName: "Infrastructure",
  });
});

test("an unscoped search has nowhere wider to go", () => {
  const reason = emptyReasonFor("kubernetes", { type: "all" }, null);
  assert.deepEqual(reason, { kind: "search", query: "kubernetes", scopeName: null });
});

test("Recent is not a scope, so searching from it searches everything", () => {
  // The sidebar reports no scope name for Recent, but this must not depend on
  // that: searching from Recent queries the whole library, so offering to
  // "search everywhere" would be offering the search that already ran.
  const reason = emptyReasonFor("kubernetes", { type: "recent" }, "Infrastructure");
  assert.deepEqual(reason, { kind: "search", query: "kubernetes", scopeName: null });
});

test("whitespace is not a search", () => {
  // An input holding only spaces sends no `q`, so the grid is showing the
  // unfiltered scope and must not claim anything failed to match.
  const reason = emptyReasonFor("   ", { type: "library", id: 3 }, "Infrastructure");
  assert.deepEqual(reason, { kind: "scope", scopeName: "Infrastructure" });
});

test("the query is trimmed before it is quoted back", () => {
  const reason = emptyReasonFor("  kubernetes  ", { type: "all" }, null);
  assert.equal(reason.kind === "search" && reason.query, "kubernetes");
});

test("an empty library is not an empty search", () => {
  assert.deepEqual(emptyReasonFor("", { type: "all" }, null), { kind: "library" });
});

test("empty favourites and empty recents say their own thing", () => {
  assert.deepEqual(emptyReasonFor("", { type: "favorites" }, "Favorites"), { kind: "favorites" });
  assert.deepEqual(emptyReasonFor("", { type: "recent" }, null), { kind: "recent" });
});

test("an empty collection names itself", () => {
  assert.deepEqual(emptyReasonFor("", { type: "collection", id: 9 }, "Drafts"), {
    kind: "scope",
    scopeName: "Drafts",
  });
});

test("a library whose name has not arrived yet falls back rather than saying 'undefined'", () => {
  // The sidebar reports null until the libraries load. Naming the scope then
  // would print "undefined is empty".
  assert.deepEqual(emptyReasonFor("", { type: "library", id: 3 }, null), { kind: "library" });
});
