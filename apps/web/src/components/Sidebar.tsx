import { useState, useEffect } from "react";
import {
  Search, Library as LibraryIcon, Star, Plus, ChevronRight, ChevronDown,
  FolderOpen, Settings, HelpCircle,
  LogOut, X, Clock,
  BookOpen, BookMarked, Palette,
  Monitor, Code2, Music, Film, Camera,
  Dumbbell, Plane, Heart, Coffee,
  Leaf, Globe, Briefcase, Gamepad2, FlaskConical,
  GraduationCap, Microscope, Landmark, Building2,
  ChefHat, TreePine, Waves, Rocket, Bot
} from "lucide-react";
import { ApiError, collectionService, libraryService, type Collection, type Library } from "../api";
import { authService } from "../api/auth";

// Map icon name strings → components for rendering
const ICON_MAP: Record<string, React.ElementType> = {
  Library: LibraryIcon, BookOpen, BookMarked, FolderOpen, Palette,
  Monitor, Code2, Music, Film, Camera, FlaskConical, Dumbbell, Plane,
  Heart, Star, Coffee, Leaf, Globe, Briefcase, Gamepad2,
  GraduationCap, Microscope, Landmark, Building2, ChefHat, TreePine,
  Waves, Rocket, Bot,
};

interface SidebarProps {
  isOpen: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  activeView: { type: 'all' | 'recent' | 'favorites' | 'library' | 'collection', id?: number };
  setActiveView: (view: { type: 'all' | 'recent' | 'favorites' | 'library' | 'collection', id?: number }) => void;
  onImport: () => void;
}

/**
 * Shared across callers so the default library is only ever created once.
 *
 * `loadData` both reads and writes, and React invokes effects twice in
 * development, so two overlapping calls would each see an empty list and both
 * POST. Deduping here means one request rather than one plus a 409.
 */
let defaultLibraryInFlight: Promise<void> | null = null;

async function ensureDefaultLibrary(): Promise<void> {
  defaultLibraryInFlight ??= (async () => {
    try {
      await libraryService.create({ name: "My Library", themeColor: "#410186" });
    } catch (err) {
      // Another tab or an earlier run got there first; that is the desired end
      // state either way.
      if (!(err instanceof ApiError && err.status === 409)) {
        defaultLibraryInFlight = null;
        throw err;
      }
    }
  })();

  return defaultLibraryInFlight;
}

export function Sidebar({ isOpen, searchQuery, setSearchQuery, activeView, setActiveView, onImport }: SidebarProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [collectionsByLibrary, setCollectionsByLibrary] = useState<Record<number, Collection[]>>({});
  const [expandedLibraries, setExpandedLibraries] = useState<Record<number, boolean>>({});

  const [promptConfig, setPromptConfig] = useState<{
    isOpen: boolean;
    title: string;
    placeholder: string;
    initialValue: string;
    onSave: (val: string) => Promise<void>;
  }>({
    isOpen: false, title: '', placeholder: '', initialValue: '', onSave: async () => {}
  });
  const [promptValue, setPromptValue] = useState("");
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptSaving, setPromptSaving] = useState(false);

  const loadData = async () => {
    try {
      let libs = await libraryService.list();
      if (libs.length === 0) {
        await ensureDefaultLibrary();
        libs = await libraryService.list();
      }
      setLibraries(libs);

      const colMap: Record<number, Collection[]> = {};
      const expMap: Record<number, boolean> = { ...expandedLibraries };
      for (const lib of libs) {
        const cols = await collectionService.list(lib.id);
        colMap[lib.id] = cols;
        if (expMap[lib.id] === undefined) expMap[lib.id] = true;
      }
      setCollectionsByLibrary(colMap);
      setExpandedLibraries(expMap);
    } catch (err) {
      console.error("Failed to load libraries", err);
    }
  };

  useEffect(() => {
    loadData();

    // Listen for custom event to trigger library rename for onboarding
    const handleRenamePrompt = async () => {
      // Onboarding is tracked per device in localStorage, but libraries live on
      // the server and are shared. A second device, a different browser, or
      // cleared site data would otherwise re-run onboarding and rename a
      // library the user had already set up. Ask the server what actually
      // exists rather than trusting the local flag.
      const libs = await libraryService.list().catch(() => null);
      if (libs === null) return;

      const isUntouchedInstall =
        libs.length === 0 ||
        (libs.length === 1 && libs[0].name === "My Library" && libs[0].documentCount === 0);

      if (!isUntouchedInstall) return;

      openPrompt("Name your first library", "Library name...", "My Library", async (val) => {
        const current = await libraryService.list();
        if (current.length > 0) {
          await libraryService.update(current[0].id, { name: val });
        } else {
          // The default library never got made, so create rather than give up.
          await libraryService.create({ name: val, themeColor: "#410186" });
        }
        await loadData();
      });
    };
    window.addEventListener('prompt-rename-first-library', handleRenamePrompt);

    // Listen for sidebar reload requests (e.g. after library/collection edit from App.tsx)
    const handleReload = () => loadData();
    window.addEventListener('reload-sidebar', handleReload);

    return () => {
      window.removeEventListener('prompt-rename-first-library', handleRenamePrompt);
      window.removeEventListener('reload-sidebar', handleReload);
    };
  }, []);

  const toggleLibrary = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedLibraries(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const openPrompt = (title: string, placeholder: string, initialValue: string, onSave: (val: string) => Promise<void>) => {
    setPromptValue(initialValue);
    setPromptError(null);
    setPromptConfig({ isOpen: true, title, placeholder, initialValue, onSave });
  };

  const closePrompt = () => {
    setPromptConfig(prev => ({ ...prev, isOpen: false }));
  };

  const handlePromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptValue.trim()) return;

    setPromptError(null);
    setPromptSaving(true);
    try {
      await promptConfig.onSave(promptValue.trim());
      closePrompt();
    } catch (err) {
      // Without this a failed save left the dialog open and silent, which reads
      // as "the Save button does nothing".
      console.error("Failed to save", err);
      setPromptError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setPromptSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <aside className="sidebar transition-all duration-300 flex-shrink-0 flex flex-col h-full bg-[var(--bg-secondary)] border-r border-[var(--border-color)]">
        <div className="sidebar-header flex justify-between items-center px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Kintara Logo" style={{ width: "58px", height: "58px", objectFit: "contain", padding: "2px" }} />
            <span
              className="text-primary tracking-wide"
              style={{ fontFamily: "'Bellota', sans-serif", fontWeight: 700, fontSize: "1.5rem" }}
            >
              Kintara
            </span>
          </div>
          <button
            className="btn btn-ghost p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-muted hover:text-primary transition-colors border-none bg-transparent cursor-pointer"
            onClick={onImport}
            title="Import Document"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="sidebar-content flex-1 overflow-y-auto px-2 py-4 flex flex-col gap-4">
          <div className="relative px-2">
            <Search className="absolute left-4 top-2.5 text-muted" size={14} />
            <input
              type="text"
              placeholder="Search documents..."
              className="input pl-8 py-2 text-sm w-full bg-[var(--bg-tertiary)] border-transparent focus:border-[var(--accent)]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div>
            <div className="uppercase text-muted mb-1 px-3 font-semibold tracking-wider" style={{ fontSize: "0.75rem" }}>Quick Views</div>
            <div
              className={`sidebar-item flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-sm mb-0.5 ${activeView.type === 'recent' ? 'active' : ''}`}
              onClick={() => setActiveView({ type: 'recent' })}
            >
              <Clock size={16} /> Recent Documents
            </div>
            <div
              className={`sidebar-item flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-sm mb-0.5 ${activeView.type === 'all' ? 'active' : ''}`}
              onClick={() => setActiveView({ type: 'all' })}
            >
              <LibraryIcon size={16} /> All Documents
            </div>
            <div
              className={`sidebar-item flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-sm mb-0.5 ${activeView.type === 'favorites' ? 'active' : ''}`}
              onClick={() => setActiveView({ type: 'favorites' })}
            >
              <Star size={16} /> Favorites
            </div>
          </div>

          <div>
            <div className="uppercase text-muted mb-1 px-3 font-semibold tracking-wider flex justify-between items-center group" style={{ fontSize: "0.75rem" }}>
              Libraries
              <button
                className="p-0.5 text-muted hover:text-primary bg-transparent border-none cursor-pointer rounded hover:bg-[var(--bg-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity"
                title="New Library"
                onClick={() => {
                  openPrompt("Create Library", "Library name...", "", async (val) => {
                    await libraryService.create({ name: val });
                    await loadData();
                  });
                }}
              >
                <Plus size={12} />
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              {libraries.map(lib => {
                const isExpanded = expandedLibraries[lib.id];
                const collections = collectionsByLibrary[lib.id] || [];
                const isActiveLib = activeView.type === 'library' && activeView.id === lib.id;

                // Resolve icon component
                const LibIcon = (lib.icon && ICON_MAP[lib.icon]) ? ICON_MAP[lib.icon] : FolderOpen;
                const iconColor = lib.iconColor || undefined;

                return (
                  <div key={`lib-${lib.id}`}>
                    <div
                      className={`sidebar-item flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm group ${isActiveLib ? 'active' : ''}`}
                      onClick={() => setActiveView({ type: 'library', id: lib.id })}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        const docId = Number(e.dataTransfer.getData('text/plain'));
                        if (docId) {
                          await libraryService.addDocument(lib.id, docId);
                          window.dispatchEvent(new CustomEvent('refresh-documents'));
                        }
                      }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <button
                          className="p-0.5 flex items-center justify-center bg-transparent border-none cursor-pointer hover:bg-black/10 rounded text-current opacity-70 transition-colors"
                          onClick={(e) => toggleLibrary(lib.id, e)}
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <LibIcon
                          size={14}
                          className="flex-shrink-0 opacity-90"
                          style={isActiveLib ? {} : (iconColor ? { color: iconColor } : {})}
                        />
                        <span className="truncate">{lib.name}</span>
                      </div>

                      {/* Only the + (new collection) button on hover */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          className="p-1 text-muted hover:text-primary bg-transparent border-none cursor-pointer rounded hover:bg-black/10"
                          title="New Collection"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedLibraries(prev => ({ ...prev, [lib.id]: true }));
                            openPrompt("New Collection", "Collection name...", "", async (val) => {
                              await collectionService.create(lib.id, val);
                              await loadData();
                            });
                          }}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>

                    {isExpanded && collections.map(col => {
                      const isActiveCol = activeView.type === 'collection' && activeView.id === col.id;
                      return (
                        <div
                          key={`col-${col.id}`}
                          className={`sidebar-item flex items-center gap-2 pl-9 pr-3 py-1.5 rounded-md cursor-pointer text-sm ${isActiveCol ? 'active' : ''}`}
                          onClick={() => setActiveView({ type: 'collection', id: col.id })}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                          onDrop={async (e) => {
                            e.preventDefault();
                            const docId = Number(e.dataTransfer.getData('text/plain'));
                            if (docId) {
                              await collectionService.addDocument(col.id, docId);
                              window.dispatchEvent(new CustomEvent('refresh-documents'));
                            }
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 flex-shrink-0"></span>
                          <span className="truncate">{col.name}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="mt-auto px-4 py-3 border-t border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-primary)]">
          <button
            className="btn btn-ghost p-2 rounded-md hover:bg-[var(--bg-tertiary)] text-muted hover:text-primary transition-colors flex items-center justify-center border-none cursor-pointer bg-transparent"
            onClick={() => window.dispatchEvent(new CustomEvent('open-settings'))}
            title="Settings (Ctrl+,)"
          >
            <Settings size={18} />
          </button>
          <button
            className="btn btn-ghost p-2 rounded-md hover:bg-[var(--bg-tertiary)] text-muted hover:text-primary transition-colors flex items-center justify-center border-none cursor-pointer bg-transparent"
            onClick={() => window.dispatchEvent(new CustomEvent('open-help'))}
            title="Help & Shortcuts (F1)"
          >
            <HelpCircle size={18} />
          </button>
          <button
            className="p-2 rounded text-muted hover:text-primary hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-center border-none cursor-pointer bg-transparent"
            onClick={async () => {
              await authService.logout().catch(() => {});
              // The gate listens for this and drops back to the sign-in form.
              window.dispatchEvent(new CustomEvent("kintara-unauthorized"));
            }}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* Reusable Prompt Modal */}
      {promptConfig.isOpen && (
        <div className="fixed-overlay z-100 animate-in fade-in duration-200">
          <div className="modal-content" style={{ maxWidth: '350px' }}>
            <div className="modal-header">
              <h2 className="font-semibold text-md m-0">{promptConfig.title}</h2>
              <button className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-muted transition-colors border-none bg-transparent cursor-pointer" onClick={closePrompt}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handlePromptSubmit} className="modal-body">
              <input
                type="text"
                autoFocus
                className="input py-2 px-3 text-sm"
                placeholder={promptConfig.placeholder}
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
              />
              {promptError && (
                <p className="auth-error" role="alert">{promptError}</p>
              )}
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" className="btn btn-ghost" onClick={closePrompt}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!promptValue.trim() || promptSaving}>
                  {promptSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
