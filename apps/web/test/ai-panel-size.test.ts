import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_PANEL_DEFAULT_WIDTH,
  AI_PANEL_MAX_WIDTH,
  AI_PANEL_MIN_WIDTH,
  clampAiPanelWidth,
  loadAiPanelWidth,
} from "../src/lib/ai-panel-size.ts";

test("AI panel width stays readable and cannot take the whole desktop", () => {
  assert.equal(clampAiPanelWidth(100), AI_PANEL_MIN_WIDTH);
  assert.equal(clampAiPanelWidth(900), AI_PANEL_MAX_WIDTH);
  assert.equal(clampAiPanelWidth(700, 900), 580);
});

test("AI panel width loads a valid preference and rejects invalid storage", () => {
  assert.equal(loadAiPanelWidth({ getItem: () => "512" }), 512);
  assert.equal(loadAiPanelWidth({ getItem: () => "not-a-number" }), AI_PANEL_DEFAULT_WIDTH);
  assert.equal(loadAiPanelWidth(null), AI_PANEL_DEFAULT_WIDTH);
});
