import { useState, useEffect } from "react";
import {
  X, Trash2, Check,
  Library as LibraryIcon,
  BookOpen, BookMarked, FolderOpen, Palette,
  Monitor, Code2, Music, Film, Camera,
  Dumbbell, Plane, Heart, Star, Coffee,
  Leaf, Globe, Briefcase, Gamepad2, FlaskConical,
  GraduationCap, Microscope, Landmark, Building2,
  ChefHat, TreePine, Waves, Rocket, Bot
} from "lucide-react";
import { collectionService, libraryService, type Collection, type Library } from "../api";

// ─── Icon catalogue ──────────────────────────────────────────────────────────
const ICONS: { name: string; component: React.ElementType }[] = [
  { name: "Library",       component: LibraryIcon   },
  { name: "BookOpen",      component: BookOpen      },
  { name: "BookMarked",    component: BookMarked    },
  { name: "FolderOpen",    component: FolderOpen    },
  { name: "Palette",       component: Palette       },
  { name: "Monitor",       component: Monitor       },
  { name: "Code2",         component: Code2         },
  { name: "Music",         component: Music         },
  { name: "Film",          component: Film          },
  { name: "Camera",        component: Camera        },
  { name: "FlaskConical",  component: FlaskConical  },
  { name: "Dumbbell",      component: Dumbbell      },
  { name: "Plane",         component: Plane         },
  { name: "Heart",         component: Heart         },
  { name: "Star",          component: Star          },
  { name: "Coffee",        component: Coffee        },
  { name: "Leaf",          component: Leaf          },
  { name: "Globe",         component: Globe         },
  { name: "Briefcase",     component: Briefcase     },
  { name: "Gamepad2",      component: Gamepad2      },
  { name: "GraduationCap", component: GraduationCap },
  { name: "Microscope",    component: Microscope    },
  { name: "Landmark",      component: Landmark      },
  { name: "Building2",     component: Building2     },
  { name: "ChefHat",       component: ChefHat       },
  { name: "TreePine",      component: TreePine      },
  { name: "Waves",         component: Waves         },
  { name: "Rocket",        component: Rocket        },
  { name: "Bot",           component: Bot           },
];

// ─── Preset colors ───────────────────────────────────────────────────────────
const PRESET_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#ec4899", // pink
  "#f43f5e", // rose
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#64748b", // slate
  "#78716c", // stone
  "#ff69b4", // pink-pixel brand
];

// ─── Props ───────────────────────────────────────────────────────────────────
interface LibrarySettingsModalProps {
  isOpen: boolean;
  mode: "library" | "collection";
  library?: Library | null;
  collection?: Collection | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export function LibrarySettingsModal({
  isOpen,
  mode,
  library,
  collection,
  onClose,
  onSaved,
  onDeleted,
}: LibrarySettingsModalProps) {
  const [name, setName] = useState("");
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>("#6366f1");
  const [customColor, setCustomColor] = useState("#6366f1");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset form whenever the target changes
  useEffect(() => {
    if (!isOpen) return;
    setConfirmDelete(false);
    if (mode === "library" && library) {
      setName(library.name);
      setSelectedIcon(library.icon ?? null);
      const c = library.iconColor ?? "#6366f1";
      setSelectedColor(c);
      setCustomColor(c);
    } else if (mode === "collection" && collection) {
      setName(collection.name);
      setSelectedIcon(null);
      setSelectedColor("#6366f1");
      setCustomColor("#6366f1");
    }
  }, [isOpen, mode, library, collection]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (mode === "library" && library) {
        await libraryService.update(library.id, {
          name: name.trim(),
          icon: selectedIcon,
          iconColor: selectedColor,
        });
      } else if (mode === "collection" && collection) {
        await collectionService.rename(collection.id, name.trim());
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error("Failed to save", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      if (mode === "library" && library) {
        await libraryService.remove(library.id);
      } else if (mode === "collection" && collection) {
        await collectionService.remove(collection.id);
      }
      onDeleted();
      onClose();
    } catch (err) {
      console.error("Failed to delete", err);
    } finally {
      setDeleting(false);
    }
  };

  const PreviewIcon = ICONS.find(i => i.name === selectedIcon)?.component ?? FolderOpen;

  return (
    <div className="fixed-overlay z-100 animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="modal-content animate-in zoom-in duration-200"
        style={{ maxWidth: "480px" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <PreviewIcon size={18} style={{ color: selectedColor }} />
            <h2 className="font-semibold text-md m-0">
              {mode === "library" ? "Library Settings" : "Collection Settings"}
            </h2>
          </div>
          <button
            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-muted transition-colors border-none bg-transparent cursor-pointer"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ gap: "1.25rem" }}>
          {/* Name */}
          <div>
            <label style={labelStyle}>Name</label>
            <input
              type="text"
              autoFocus
              className="input py-2 px-3 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            />
          </div>

          {/* Icon picker — only for libraries */}
          {mode === "library" && (
            <>
              <div>
                <label style={labelStyle}>Icon</label>
                <div style={iconGridStyle}>
                  {ICONS.map(({ name: iconName, component: IconComp }) => (
                    <button
                      key={iconName}
                      title={iconName}
                      onClick={() => setSelectedIcon(iconName)}
                      style={{
                        ...iconBtnBase,
                        background: selectedIcon === iconName
                          ? `${selectedColor}22`
                          : "var(--bg-tertiary)",
                        borderColor: selectedIcon === iconName
                          ? selectedColor
                          : "transparent",
                        color: selectedIcon === iconName
                          ? selectedColor
                          : "var(--text-muted)",
                      }}
                    >
                      <IconComp size={16} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Color picker */}
              <div>
                <label style={labelStyle}>Icon Color</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setSelectedColor(c); setCustomColor(c); }}
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "50%",
                        background: c,
                        border: selectedColor === c ? "2px solid var(--text-primary)" : "2px solid transparent",
                        cursor: "pointer",
                        flexShrink: 0,
                        outline: "none",
                        position: "relative",
                      }}
                    >
                      {selectedColor === c && (
                        <Check
                          size={12}
                          style={{
                            position: "absolute",
                            top: "50%", left: "50%",
                            transform: "translate(-50%, -50%)",
                            color: "#fff",
                          }}
                        />
                      )}
                    </button>
                  ))}
                  {/* Custom hex */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginLeft: "0.25rem" }}>
                    <input
                      type="color"
                      value={customColor}
                      onChange={(e) => {
                        setCustomColor(e.target.value);
                        setSelectedColor(e.target.value);
                      }}
                      style={{
                        width: "28px", height: "28px",
                        borderRadius: "50%", border: "none",
                        cursor: "pointer", padding: 0,
                        background: "none",
                      }}
                      title="Custom color"
                    />
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                      {selectedColor.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Delete zone */}
          <div style={{
            borderTop: "1px solid var(--border-color)",
            paddingTop: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}>
            {confirmDelete ? (
              <div style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "var(--radius-md)",
                padding: "0.875rem",
              }}>
                <p style={{ fontSize: "0.8125rem", color: "var(--text-primary)", marginBottom: "0.75rem", lineHeight: 1.5 }}>
                  {mode === "library"
                    ? "Delete this library? Documents inside will remain in your collection, but will be removed from this library."
                    : "Delete this collection? Documents won't be deleted — only removed from this collection."}
                </p>
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn"
                    style={{ background: "#ef4444", color: "#fff" }}
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    <Trash2 size={14} style={{ marginRight: "0.375rem" }} />
                    {deleting ? "Deleting…" : "Yes, Delete"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn btn-ghost"
                style={{ color: "#ef4444", alignSelf: "flex-start", fontSize: "0.8125rem" }}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} style={{ marginRight: "0.375rem" }} />
                Delete {mode === "library" ? "Library" : "Collection"}
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "0.875rem 1.25rem",
          borderTop: "1px solid var(--border-color)",
          display: "flex",
          justifyContent: "flex-end",
          gap: "0.5rem",
          background: "var(--bg-primary)",
        }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!name.trim() || saving}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline styles ────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-muted)",
  fontWeight: 600,
  marginBottom: "0.5rem",
};

const iconGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(36px, 1fr))",
  gap: "0.375rem",
};

const iconBtnBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "36px",
  height: "36px",
  borderRadius: "var(--radius-md)",
  border: "1px solid transparent",
  cursor: "pointer",
  transition: "all 0.15s ease",
};
