/**
 * Display settings, stored per device in localStorage.
 *
 * These stay local on purpose rather than syncing per user: a phone and a
 * desktop genuinely want different font sizes, and reading these synchronously
 * means the theme is applied before first paint instead of flashing.
 */

export interface Settings {
  fontFamily: string;
  fontSize: string;
  theme: "dark" | "light" | "system";
  readerTheme: "dark" | "light" | "system";
  highlightColor: string;
  hasSeenOnboarding: boolean;
}

/** Values carried over unchanged from the desktop build. */
export const defaultSettings: Settings = {
  fontFamily: "Inter, system-ui, Avenir, Helvetica, Arial, sans-serif",
  fontSize: "14px",
  theme: "dark",
  readerTheme: "light",
  highlightColor: "rgba(139, 92, 246, 0.35)",
  hasSeenOnboarding: false,
};

const STORAGE_KEY = "kintara.settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultSettings };
    // Spread over the defaults so a settings blob written by an older version
    // gains new keys rather than leaving them undefined.
    return { ...defaultSettings, ...JSON.parse(raw) };
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
  root.style.fontSize = settings.fontSize;
  root.style.setProperty("--highlight-color", settings.highlightColor);

  if (settings.theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", settings.theme);
  }

  if (settings.readerTheme) {
    root.setAttribute("data-reader-theme", settings.readerTheme);
  }
}
