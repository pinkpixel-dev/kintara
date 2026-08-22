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
import { SidebarPrompt, type PromptConfig } from "./SidebarPrompt";
import { SidebarRowMenu, type RowMenuState } from "./SidebarRowMenu";

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
  /** Drops the scope but keeps the query, so the same search runs everywhere. */
  onSearchEverywhere: () => void;
  /**
   * Reports the name of the scope currently being searched, or null when there
   * is none. The names live here because this is what loads the libraries and
   * collections; the empty grid needs them to say what emptied it.
   */
  onScopeNameChange: (name: string | null) => void;
  /** A target files the uploaded document straight into that library or collection. */
  onImport: (target?: ImportTarget) => void;
}

/** Where an import should land, when it is started from a specific row. */
export interface ImportTarget {
  libraryId?: number;
  collectionId?: number;
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

export function Sidebar({ isOpen, searchQuery, setSearchQuery, activeView, setActiveView, onSearchEverywhere, onScopeNameChange, onImport }: SidebarProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [collectionsByLibrary, setCollectionsByLibrary] = useState<Record<number, Collection[]>>({});
  const [expandedLibraries, setExpandedLibraries] = useState<Record<number, boolean>>({});

  const [prompt, setPrompt] = useState<PromptConfig | null>(null);

  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);

  const openRowMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    libraryId: number,
    name: string,
  ) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setRowMenu({
      libraryId,
      name,
      right: Math.max(8, window.innerWidth - rect.right),
      y: rect.bottom + 4,
    });
  };

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

  const openPrompt = (
    title: string,
    placeholder: string,
    initialValue: string,
    onSave: (value: string) => Promise<void>,
  ) => setPrompt({ title, placeholder, initialValue, onSave });

  /**
   * What the search box is currently searching inside, or null for everything.
   *
   * Derived from the active view rather than held as its own state, so the
   * scope and the view can never disagree. "Recent" is not a scope — the server
   * has no filter for it — so searching from there searches everything.
   */
  const scopeName = (() => {
    if (activeView.type === 'library') {
      return libraries.find(lib => lib.id === activeView.id)?.name ?? null;
    }
    if (activeView.type === 'collection') {
      for (const collections of Object.values(collectionsByLibrary)) {
        const match = collections.find(col => col.id === activeView.id);
        if (match) return match.name;
      }
      return null;
    }
    if (activeView.type === 'favorites') return 'Favorites';
    return null;
  })();

  // Pushed up rather than derived again in App, which does not hold the
  // libraries or collections and would need a second request to name one.
  useEffect(() => {
    onScopeNameChange(scopeName);
  }, [scopeName, onScopeNameChange]);

  if (!isOpen) return null;

  return (
    <>
      <aside className="sidebar transition-all duration-300 flex-shrink-0 flex flex-col h-full bg-[var(--bg-secondary)] border-r border-[var(--border-color)]">
        <div className="sidebar-header flex justify-between items-center px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            {/* Sized in em so it grows with the interface size setting; a fixed
                pixel logo next to scaling wordmark drifts out of proportion. */}
            <img
              src="/logo.png"
              alt="Kintara Logo"
              style={{ width: "4.15em", height: "4.15em", objectFit: "contain", padding: "2px" }}
            />
            <span
              className="text-primary tracking-wide"
              style={{ fontFamily: "'Bellota', sans-serif", fontWeight: 700, fontSize: "1.5rem" }}
            >
              Kintara
            </span>
          </div>
          <button
            className="sidebar-icon-btn"
            onClick={() => onImport()}
            title="Import Document"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="sidebar-content px-2 flex flex-col gap-4">
          <div className="px-2">
            <div className="search-field sidebar-search">
              <Search className="search-field-icon" size={14} aria-hidden="true" />
              <input
                type="text"
                placeholder={scopeName ? `Search in ${scopeName}...` : "Search documents..."}
                aria-label={scopeName ? `Search in ${scopeName}` : "Search all documents"}
                className="input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Only while there is something to widen. Before you type, the
                placeholder already says where the search will land. */}
            {scopeName && searchQuery.trim().length > 0 && (
              <div className="search-scope" aria-live="polite">
                <span className="search-scope-label truncate">in {scopeName}</span>
                <button
                  type="button"
                  className="search-scope-clear"
                  onClick={onSearchEverywhere}
                  title="Search everywhere instead"
                  aria-label={`Stop searching in ${scopeName} and search everywhere`}
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>

          <div>
            <div className="sidebar-section-label">Quick Views</div>
            <div
              className={`sidebar-item flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-sm ${activeView.type === 'recent' ? 'active' : ''}`}
              onClick={() => setActiveView({ type: 'recent' })}
            >
              <Clock size={16} /> Recent Documents
            </div>
            <div
              className={`sidebar-item flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-sm ${activeView.type === 'all' ? 'active' : ''}`}
              onClick={() => setActiveView({ type: 'all' })}
            >
              <LibraryIcon size={16} /> All Documents
            </div>
            <div
              className={`sidebar-item flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-sm ${activeView.type === 'favorites' ? 'active' : ''}`}
              onClick={() => setActiveView({ type: 'favorites' })}
            >
              <Star size={16} /> Favorites
            </div>
          </div>

          <div>
            <div className="sidebar-section-label">
              Libraries
              <button
                className="sidebar-section-add"
                title="New Library"
                aria-label="New Library"
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
            <div className="sidebar-tree">
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
                      className={`sidebar-item flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm ${isActiveLib ? 'active' : ''}`}
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
                      <div className="sidebar-row-label">
                        <button
                          className="sidebar-row-icon-btn"
                          onClick={(e) => toggleLibrary(lib.id, e)}
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <LibIcon
                          size={14}
                          className="flex-shrink-0"
                          style={isActiveLib ? {} : (iconColor ? { color: iconColor } : {})}
                        />
                        <span className="truncate">{lib.name}</span>
                      </div>

                      <div className="row-actions flex items-center flex-shrink-0">
                        <button
                          className="sidebar-row-action"
                          title={`Add to ${lib.name}`}
                          aria-label={`Add to ${lib.name}`}
                          aria-haspopup="menu"
                          aria-expanded={rowMenu?.libraryId === lib.id}
                          onClick={(e) => openRowMenu(e, lib.id, lib.name)}
                        >
                          <Plus size={14} />
                        </button>
                        <button
                          className="sidebar-row-action"
                          title={`${lib.name} settings`}
                          aria-label={`Settings for ${lib.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            window.dispatchEvent(
                              new CustomEvent("open-entity-settings", {
                                detail: { type: "library", id: lib.id },
                              }),
                            );
                          }}
                        >
                          <Settings size={14} />
                        </button>
                      </div>
                    </div>

                    {isExpanded && collections.map(col => {
                      const isActiveCol = activeView.type === 'collection' && activeView.id === col.id;
                      return (
                        <div
                          key={`col-${col.id}`}
                          className={`sidebar-item flex items-center gap-2 pl-9 pr-2 py-1.5 rounded-md cursor-pointer text-sm ${isActiveCol ? 'active' : ''}`}
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
                          <span className="sidebar-collection-dot"></span>
                          <span className="truncate flex-1 min-w-0">{col.name}</span>
                          <div className="row-actions flex items-center flex-shrink-0">
                            {/* One action rather than a menu: a collection holds
                                documents and nothing else, so there is nothing
                                to choose between. */}
                            <button
                              className="sidebar-row-action"
                              title={`Import a document into ${col.name}`}
                              aria-label={`Import a document into ${col.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onImport({ libraryId: lib.id, collectionId: col.id });
                              }}
                            >
                              <Plus size={14} />
                            </button>
                            <button
                              className="sidebar-row-action"
                              title={`${col.name} settings`}
                              aria-label={`Settings for ${col.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                window.dispatchEvent(
                                  new CustomEvent("open-entity-settings", {
                                    detail: { type: "collection", id: col.id },
                                  }),
                                );
                              }}
                            >
                              <Settings size={14} />
                            </button>
                          </div>
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
        <div className="sidebar-footer">
          <button
            className="sidebar-icon-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('open-settings'))}
            title="Settings (Ctrl+,)"
          >
            <Settings size={18} />
          </button>
          <button
            className="sidebar-icon-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('open-help'))}
            title="Help & Shortcuts (F1)"
          >
            <HelpCircle size={18} />
          </button>
          <button
            className="sidebar-icon-btn"
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

      {rowMenu && (
        <SidebarRowMenu
          menu={rowMenu}
          onClose={() => setRowMenu(null)}
          onImportHere={() => {
            setRowMenu(null);
            onImport({ libraryId: rowMenu.libraryId });
          }}
          onNewCollection={() => {
            setRowMenu(null);
            setExpandedLibraries(prev => ({ ...prev, [rowMenu.libraryId]: true }));
            openPrompt("New Collection", "Collection name...", "", async (val) => {
              await collectionService.create(rowMenu.libraryId, val);
              await loadData();
            });
          }}
        />
      )}

      {prompt && <SidebarPrompt config={prompt} onClose={() => setPrompt(null)} />}
    </>
  );
}
