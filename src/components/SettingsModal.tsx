import { useState, useEffect } from "react";
import { BaseDirectory, readTextFile, writeTextFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import { X, Settings as SettingsIcon, Type, Palette } from "lucide-react";

interface AppSettings {
  fontFamily: string;
  fontSize: string;
  theme: 'dark' | 'light' | 'system';
  readerTheme: 'dark' | 'light' | 'system';
  highlightColor: string;
  hasSeenOnboarding: boolean;
}

const defaultSettings: AppSettings = {
  fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif',
  fontSize: '14px',
  theme: 'dark',
  readerTheme: 'light',
  highlightColor: 'rgba(139, 92, 246, 0.35)',
  hasSeenOnboarding: false
};

// Preset highlight colors: [label, rgba value]
const HIGHLIGHT_PRESETS: { label: string; value: string; swatch: string }[] = [
  { label: "Purple",  value: "rgba(139, 92, 246, 0.35)",  swatch: "#8b5cf6" },
  { label: "Yellow",  value: "rgba(234, 179, 8, 0.4)",    swatch: "#eab308" },
  { label: "Green",   value: "rgba(34, 197, 94, 0.35)",   swatch: "#22c55e" },
  { label: "Blue",    value: "rgba(59, 130, 246, 0.35)",  swatch: "#3b82f6" },
  { label: "Pink",    value: "rgba(236, 72, 153, 0.35)",  swatch: "#ec4899" },
  { label: "Orange",  value: "rgba(249, 115, 22, 0.35)",  swatch: "#f97316" },
  { label: "Teal",    value: "rgba(20, 184, 166, 0.35)",  swatch: "#14b8a6" },
  { label: "Red",     value: "rgba(239, 68, 68, 0.35)",   swatch: "#ef4444" },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      if (await exists('settings.json', { baseDir: BaseDirectory.AppLocalData })) {
        const data = await readTextFile('settings.json', { baseDir: BaseDirectory.AppLocalData });
        const parsed = JSON.parse(data);
        setSettings({ ...defaultSettings, ...parsed });
      } else {
        await saveSettings(defaultSettings);
      }
    } catch (err) {
      console.error("Failed to load settings", err);
    }
  };

  const saveSettings = async (newSettings: AppSettings) => {
    applySettingsToDom(newSettings);
    try {
      const hasDir = await exists('', { baseDir: BaseDirectory.AppLocalData });
      if (!hasDir) {
        await mkdir('', { baseDir: BaseDirectory.AppLocalData, recursive: true });
      }
      await writeTextFile('settings.json', JSON.stringify(newSettings, null, 2), { baseDir: BaseDirectory.AppLocalData });
      setSettings(newSettings);
    } catch (err) {
      console.error("Failed to save settings", err);
    }
  };

  const applySettingsToDom = (s: AppSettings) => {
    document.documentElement.style.setProperty('--font-family', s.fontFamily);
    document.documentElement.style.fontSize = s.fontSize;
    document.documentElement.style.setProperty('--highlight-color', s.highlightColor ?? defaultSettings.highlightColor);
    if (s.theme !== 'system') {
      document.documentElement.setAttribute('data-theme', s.theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (s.readerTheme) {
      document.documentElement.setAttribute('data-reader-theme', s.readerTheme);
    }
  };

  const updateSetting = (key: keyof AppSettings, value: any) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed-overlay animate-in fade-in duration-200">
      <div className="modal-content">
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <SettingsIcon size={18} className="text-[var(--accent)]" />
            <h2 className="font-semibold text-lg m-0">Settings</h2>
          </div>
          <button className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-muted transition-colors border-none bg-transparent cursor-pointer" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        
        <div className="modal-body">
          {/* Appearance */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3 flex items-center gap-2">
              <Palette size={14} /> Appearance
            </h3>
            <div className="flex flex-col gap-4 pl-1">
              <div className="flex items-center justify-between">
                <label className="text-sm">Theme</label>
                <select 
                  className="input py-1 px-2 text-sm w-32"
                  value={settings.theme}
                  onChange={(e) => updateSetting('theme', e.target.value)}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </div>
              <div className="flex items-center justify-between mt-2">
                <label className="text-sm">Reader Theme</label>
                <select 
                  className="input py-1 px-2 text-sm w-32"
                  value={settings.readerTheme || 'light'}
                  onChange={(e) => updateSetting('readerTheme', e.target.value)}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </div>
            </div>
          </section>

          {/* Typography */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3 flex items-center gap-2">
              <Type size={14} /> Typography
            </h3>
            <div className="flex flex-col gap-4 pl-1">
              <div className="flex items-center justify-between">
                <label className="text-sm">Font Family</label>
                <select 
                  className="input py-1 px-2 text-sm w-32"
                  value={settings.fontFamily}
                  onChange={(e) => updateSetting('fontFamily', e.target.value)}
                >
                  <option value="Inter, system-ui, Avenir, Helvetica, Arial, sans-serif">Inter</option>
                  <option value="Georgia, serif">Georgia</option>
                  <option value="ui-monospace, monospace">Monospace</option>
                  <option value="Outfit, sans-serif">Outfit</option>
                  <option value="Livvic, sans-serif">Livvic</option>
                  <option value="'M PLUS U', sans-serif">M PLUS U</option>
                  <option value="Bellota, sans-serif">Bellota</option>
                  <option value="Elsie, serif">Elsie</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm">Base Font Size</label>
                <select 
                  className="input py-1 px-2 text-sm w-32"
                  value={settings.fontSize}
                  onChange={(e) => updateSetting('fontSize', e.target.value)}
                >
                  <option value="12px">Small (12px)</option>
                  <option value="14px">Medium (14px)</option>
                  <option value="16px">Large (16px)</option>
                  <option value="18px">Extra Large (18px)</option>
                </select>
              </div>
            </div>
          </section>

          {/* Highlights */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3 flex items-center gap-2">
              <span style={{ fontSize: "14px" }}>🖊</span> Highlights
            </h3>
            <div className="pl-1">
              <label className="text-sm" style={{ display: "block", marginBottom: "0.625rem" }}>Highlight Color</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {HIGHLIGHT_PRESETS.map((preset) => {
                  const isActive = settings.highlightColor === preset.value;
                  return (
                    <button
                      key={preset.value}
                      title={preset.label}
                      onClick={() => updateSetting('highlightColor', preset.value)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "0.25rem",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "0.25rem",
                        borderRadius: "var(--radius-md)",
                        outline: isActive ? `2px solid ${preset.swatch}` : "2px solid transparent",
                        outlineOffset: "2px",
                        transition: "outline 0.15s ease",
                      }}
                    >
                      <span style={{
                        display: "block",
                        width: "28px",
                        height: "18px",
                        borderRadius: "3px",
                        backgroundColor: preset.value,
                        border: "1px solid rgba(0,0,0,0.12)",
                      }} />
                      <span style={{ fontSize: "10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {preset.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "0.75rem", lineHeight: 1.5 }}>
                Click highlighted text to remove it.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export { defaultSettings, type AppSettings };
