import { useState, useEffect } from "react";
import {
  accents,
  applySettings,
  defaultSettings,
  loadSettings,
  saveSettings,
  uiSizes,
  type Settings,
} from "../lib/settings";
import { X, Settings as SettingsIcon, Type, Palette } from "lucide-react";
import { AiSettingsSection } from "./AiSettingsSection";
import { AccessSettingsSection } from "./AccessSettingsSection";
import type { AiSettings } from "../api";

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
  onAiSettingsSaved: (settings: AiSettings) => void;
}

export function SettingsModal({ isOpen, onClose, onAiSettingsSaved }: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  useEffect(() => {
    if (isOpen) {
      readSettings();
    }
  }, [isOpen]);

  const readSettings = () => {
    setSettings(loadSettings());
  };

  /** Settings apply immediately and persist to localStorage — no Save button. */
  const updateSetting = (key: keyof Settings, value: any) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    applySettings(next);
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
          <button className="modal-close" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>
        
        <div className="modal-body">
          {/* Appearance */}
          <section>
            <h3 className="settings-section-title">
              <Palette size={14} /> Appearance
            </h3>
            <div className="settings-section-body">
              <div className="flex items-center justify-between">
                <label className="text-sm">Theme</label>
                <select 
                  className="input settings-control"
                  value={settings.theme}
                  onChange={(e) => updateSetting('theme', e.target.value)}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </div>
              {/* Swatches rather than a select: the whole point of the
                  setting is the colour, and a dropdown of colour names makes
                  you pick one to find out what it looks like. Each swatch
                  carries its own data-accent so it paints itself from the same
                  table the app uses. */}
              <div className="flex flex-col gap-2 mt-2">
                <span className="text-sm">Accent Colour</span>
                <div className="accent-grid" role="group" aria-label="Accent colour">
                  {accents.map((option) => {
                    const isActive = settings.accent === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className="accent-option"
                        data-accent={option.value}
                        aria-pressed={isActive}
                        aria-label={option.label}
                        title={option.label}
                        onClick={() => updateSetting('accent', option.value)}
                      >
                        <span className="accent-swatch" />
                        <span className="accent-option-label">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <label className="text-sm">Reader Theme</label>
                <select
                  className="input settings-control"
                  value={settings.readerTheme || 'light'}
                  onChange={(e) => updateSetting('readerTheme', e.target.value)}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </div>
              {/* Sits with the theme rather than under Typography: it moves the
                  cards and icons as much as it moves the text. */}
              <div className="flex items-center justify-between mt-2">
                <label className="text-sm" htmlFor="ui-size">Interface Size</label>
                <select
                  id="ui-size"
                  className="input settings-control"
                  value={settings.uiSize}
                  onChange={(e) => updateSetting('uiSize', e.target.value)}
                >
                  {uiSizes.map((size) => (
                    <option key={size.value} value={size.value}>{size.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Typography */}
          <section>
            <h3 className="settings-section-title">
              <Type size={14} /> Typography
            </h3>
            <div className="settings-section-body">
              <div className="flex items-center justify-between">
                <label className="text-sm">Font Family</label>
                <select 
                  className="input settings-control"
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
            </div>
          </section>

          {/* Highlights */}
          <section>
            <h3 className="settings-section-title">
              <span style={{ fontSize: "14px" }}>🖊</span> Highlights
            </h3>
            <div className="settings-section-body">
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
            </div>
          </section>

          <AiSettingsSection onSaved={onAiSettingsSaved} />
          <AccessSettingsSection />
        </div>
      </div>
    </div>
  );
}

export { defaultSettings, type Settings };
