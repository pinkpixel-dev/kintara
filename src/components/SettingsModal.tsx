import { useState, useEffect } from "react";
import { BaseDirectory, readTextFile, writeTextFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import { X, Settings as SettingsIcon, Type, Palette } from "lucide-react";

interface AppSettings {
  fontFamily: string;
  fontSize: string;
  theme: 'dark' | 'light' | 'system';
  readerTheme: 'dark' | 'light' | 'system';
  hasSeenOnboarding: boolean;
}

const defaultSettings: AppSettings = {
  fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif',
  fontSize: '14px',
  theme: 'dark',
  readerTheme: 'light',
  hasSeenOnboarding: false
};

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
        // AppLocalData directory might not exist yet
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
                </select>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export { defaultSettings, type AppSettings };
