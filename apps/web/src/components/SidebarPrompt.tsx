import { useState } from "react";
import { X } from "lucide-react";

export interface PromptConfig {
  title: string;
  placeholder: string;
  initialValue: string;
  onSave: (value: string) => Promise<void>;
}

interface SidebarPromptProps {
  config: PromptConfig;
  onClose: () => void;
}

/**
 * The single-field dialog behind naming a library or a collection.
 *
 * A failed save keeps the dialog open and says why: swallowing the error left
 * it open and silent, which reads as a Save button that does nothing.
 */
export function SidebarPrompt({ config, onClose }: SidebarPromptProps) {
  const [value, setValue] = useState(config.initialValue);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;

    setError(null);
    setSaving(true);
    try {
      await config.onSave(value.trim());
      onClose();
    } catch (err) {
      console.error("Failed to save", err);
      setError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed-overlay z-100 animate-in fade-in duration-200">
      <div className="modal-content" style={{ maxWidth: '350px' }}>
        <div className="modal-header">
          <h2 className="dialog-title">{config.title}</h2>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <input
            type="text"
            autoFocus
            className="input py-2 px-3 text-sm"
            placeholder={config.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!value.trim() || saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
