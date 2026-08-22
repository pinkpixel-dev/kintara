import test from "node:test";
import assert from "node:assert/strict";
import { highlightBoxes, locatePassage, type TextPiece } from "../src/lib/pdf-text-locate.ts";

/** A run of text 10px per character, on a 12px line. */
const piece = (
  str: string,
  left: number,
  top: number,
  endsLine = false,
): TextPiece => ({ str, left, top, width: str.length * 10, height: 12, endsLine });

test("a quote inside one run is boxed over just that quote", () => {
  const boxes = locatePassage([piece("Start with a magic ring", 0, 100, true)], "magic ring");
  assert.equal(boxes.length, 1);
  // "magic ring" starts at character 13 of 23 and runs to the end.
  assert.ok(Math.abs(boxes[0].x - (13 / 23) * 230) < 0.01);
  assert.ok(Math.abs(boxes[0].w - (10 / 23) * 230) < 0.01);
  assert.equal(boxes[0].y, 100);
  assert.equal(boxes[0].h, 12);
});

test("a word pdf.js split across two runs still matches", () => {
  // This is the case that breaks naive matching: the page draws "highlight"
  // as two runs, so any whitespace-preserving comparison sees "high light".
  const boxes = locatePassage(
    [piece("high", 0, 50), piece("light the row", 40, 50, true)],
    "highlight",
  );
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].x, 0);
  // Covers "high" plus "light" from the second run.
  assert.ok(Math.abs(boxes[0].w - (40 + (5 / 13) * 130)) < 0.01);
});

test("a quote spanning two lines produces one box per line", () => {
  const boxes = locatePassage(
    [piece("Start with a magic ring of six", 0, 100, true), piece("stitches, then work", 0, 120, true)],
    "magic ring of six stitches",
  );
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].y, 100);
  assert.equal(boxes[1].y, 120);
  // The second line's box starts at its left edge and stops after "stitches,".
  assert.equal(boxes[1].x, 0);
  assert.ok(boxes[1].w < 19 * 10);
});

test("line breaks come from hasEOL, not from vertical position", () => {
  // Two runs at the same top that pdf.js marked as separate lines still get
  // separate boxes; a two-column page puts unrelated text on the same y.
  const boxes = locatePassage(
    [piece("alpha", 0, 10, true), piece("beta", 300, 10, true)],
    "alphabeta",
  );
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].x, 0);
  assert.equal(boxes[1].x, 300);
});

test("whitespace and casing in the quote are ignored", () => {
  const pieces = [piece("Fasten off and weave in the ends.", 0, 0, true)];
  for (const quote of ["fasten off", "FASTEN  OFF", "Fasten\noff", " fasten off "]) {
    assert.equal(locatePassage(pieces, quote).length, 1, quote);
  }
});

test("text that is not on the page returns nothing rather than guessing", () => {
  const pieces = [piece("Fasten off and weave in the ends.", 0, 0, true)];
  assert.deepEqual(locatePassage(pieces, "begin with a magic circle"), []);
  assert.deepEqual(locatePassage(pieces, ""), []);
  assert.deepEqual(locatePassage(pieces, "   "), []);
});

test("runs with no text or no width cannot produce a box", () => {
  const boxes = locatePassage(
    [{ str: "", left: 0, top: 0, width: 0, height: 12, endsLine: false }, piece("ring", 0, 0, true)],
    "ring",
  );
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].w, 40);
});

test("both stored highlight shapes are read back", () => {
  const legacy = JSON.stringify({ page: 2, x: 10, y: 20, w: 30, h: 40 });
  assert.deepEqual(highlightBoxes(legacy, 2), [{ x: 10, y: 20, w: 30, h: 40 }]);
  assert.deepEqual(highlightBoxes(legacy, 3), []);

  const multi = JSON.stringify({ page: 1, boxes: [{ x: 0, y: 0, w: 5, h: 6 }, { x: 0, y: 10, w: 7, h: 6 }] });
  assert.equal(highlightBoxes(multi, 1).length, 2);
});

test("malformed stored positions are ignored rather than thrown", () => {
  assert.deepEqual(highlightBoxes("not json", 1), []);
  assert.deepEqual(highlightBoxes("null", 1), []);
  assert.deepEqual(highlightBoxes(JSON.stringify({ page: 1 }), 1), []);
  assert.deepEqual(highlightBoxes(JSON.stringify({ page: 1, boxes: [{ x: 1 }] }), 1), []);
});
