export const AI_PANEL_DEFAULT_WIDTH = 440;
export const AI_PANEL_MIN_WIDTH = 360;
export const AI_PANEL_MAX_WIDTH = 720;
export const AI_PANEL_WIDTH_KEY = "kintara.aiPanelWidth";

export function clampAiPanelWidth(width: number, viewportWidth = Number.POSITIVE_INFINITY) {
  const viewportLimit = Number.isFinite(viewportWidth)
    ? Math.max(AI_PANEL_MIN_WIDTH, viewportWidth - 320)
    : AI_PANEL_MAX_WIDTH;
  return Math.round(Math.min(Math.max(width, AI_PANEL_MIN_WIDTH), AI_PANEL_MAX_WIDTH, viewportLimit));
}

export function loadAiPanelWidth(storage: Pick<Storage, "getItem"> | null) {
  const stored = storage?.getItem(AI_PANEL_WIDTH_KEY);
  const parsed = stored ? Number(stored) : AI_PANEL_DEFAULT_WIDTH;
  return Number.isFinite(parsed) ? clampAiPanelWidth(parsed) : AI_PANEL_DEFAULT_WIDTH;
}
