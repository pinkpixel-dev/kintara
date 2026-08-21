/**
 * Display settings, stored per device in localStorage.
 *
 * These stay local on purpose rather than syncing per user: a phone and a
 * desktop genuinely want different font sizes, and reading these synchronously
 * means the theme is applied before first paint instead of flashing.
 */

/**
 * How large the interface is drawn.
 *
 * This replaced a "base font size" setting that only ever changed text. The
 * cards, icons, and chrome around the text stayed put, so small and medium
 * looked identical and the whole control read as broken. One step here scales
 * all of it together.
 */
export type UiSize = "sm" | "md" | "lg" | "xl";

export const uiSizes: { value: UiSize; label: string }[] = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "Extra Large" },
];

/**
 * Which accent the interface is drawn in.
 *
 * Only the name lives here. The colours themselves are in `App.css`, one block
 * per accent holding both a light-theme and a dark-theme value, because the
 * theme has to be able to pick between them without JavaScript deciding what
 * "system" currently means.
 */
export type Accent =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "cyan"
  | "purple"
  | "pink";

export const accents: { value: Accent; label: string }[] = [
  { value: "red", label: "Red" },
  { value: "orange", label: "Orange" },
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "cyan", label: "Cyan" },
  { value: "purple", label: "Purple" },
  { value: "pink", label: "Pink" },
];

export interface Settings {
  fontFamily: string;
  uiSize: UiSize;
  accent: Accent;
  theme: "dark" | "light" | "system";
  readerTheme: "dark" | "light" | "system";
  highlightColor: string;
  hasSeenOnboarding: boolean;
}

/** Values carried over unchanged from the desktop build. */
export const defaultSettings: Settings = {
  fontFamily: "Inter, system-ui, Avenir, Helvetica, Arial, sans-serif",
  uiSize: "sm",
  // The Pink Pixel brand purple, which is what the app was before this setting
  // existed. Anyone who never opens Settings sees no change at all.
  accent: "purple",
  theme: "dark",
  readerTheme: "light",
  highlightColor: "rgba(139, 92, 246, 0.35)",
  hasSeenOnboarding: false,
};

/**
 * Maps the old `fontSize` setting onto the new scale.
 *
 * Small is deliberately today's appearance, so anyone on the old 12px or 14px
 * default sees nothing change. 16px and 18px map to the steps that are actually
 * bigger than what they had.
 */
const legacyFontSizes: Record<string, UiSize> = {
  "12px": "sm",
  "14px": "sm",
  "16px": "lg",
  "18px": "xl",
};

const STORAGE_KEY = "kintara.settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultSettings };
    // Spread over the defaults so a settings blob written by an older version
    // gains new keys rather than leaving them undefined.
    const stored = { ...defaultSettings, ...JSON.parse(raw) } as Settings & { fontSize?: string };

    // Anyone who set a font size before this became a UI size keeps a sensible
    // equivalent rather than being silently reset to the default.
    if (stored.fontSize && !JSON.parse(raw).uiSize) {
      stored.uiSize = legacyFontSizes[stored.fontSize] ?? defaultSettings.uiSize;
    }
    delete stored.fontSize;

    return stored;
  } catch {
    // Corrupt JSON, or localStorage blocked in a private window.
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or unavailable. The in-memory settings still apply for this
    // session, so this is not worth interrupting the user over.
  }
}

/** Applies settings to the document root. Safe to call repeatedly. */
export function applySettings(settings: Settings): void {
  const root = document.documentElement;

  root.style.setProperty("--font-family", settings.fontFamily);
  root.style.setProperty("--highlight-color", settings.highlightColor);

  // The stylesheet owns what each step means; this only says which one is in
  // force. Set as an attribute rather than an inline scale so the steps stay
  // tunable in one place.
  root.setAttribute("data-ui-size", settings.uiSize);

  // Same reasoning as the size step: the stylesheet owns what each accent
  // means, and this only says which one is live. Setting the attribute rather
  // than writing the colours inline is also what lets the dark theme pick a
  // different value for the same accent.
  root.setAttribute("data-accent", settings.accent);

  if (settings.theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", settings.theme);
  }

  if (settings.readerTheme) {
    root.setAttribute("data-reader-theme", settings.readerTheme);
  }
}
