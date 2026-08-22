import { useState, useEffect } from "react";
import {
  Search, Library as LibraryIcon, Star, Plus, Settings, HelpCircle,
  LogOut, X, Clock,
} from "lucide-react";
import { collectionService, libraryService, type Collection, type Library } from "../api";
import { authService } from "../api/auth";
import { SidebarPrompt, type PromptConfig } from "./SidebarPrompt";
import { SidebarRowMenu, type RowMenuState } from "./SidebarRowMenu";
import { SidebarLibraryGroup } from "./SidebarLibraryGroups";

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

export function Sidebar({ isOpen, searchQuery, setSearchQuery, activeView, setActiveView, onSearchEverywhere, onScopeNameChange, onImport }: SidebarProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [collectionsByLibrary, setCollectionsByLibrary] = useState<Record<number, Collection[]>>({});
  const [expandedLibraries, setExpandedLibraries] = useState<Record<number, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("kintara.sidebar.expandedLibraries") ?? "{}");
    } catch {
      return {};
    }
  });
  const [ownedExpanded, setOwnedExpanded] = useState(
    () => localStorage.getItem("kintara.sidebar.myLibraries") !== "false",
  );
  const [sharedExpanded, setSharedExpanded] = useState(
    () => localStorage.getItem("kintara.sidebar.sharedLibraries") === "true",
  );
  const [sidebarMessage, setSidebarMessage] = useState<string | null>(null);

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
      const libs = await libraryService.list();
      setLibraries(libs);

      const colMap: Record<number, Collection[]> = {};
      const expMap: Record<number, boolean> = { ...expandedLibraries };
      for (const lib of libs) {
        const cols = await collectionService.list(lib.id);
        colMap[lib.id] = cols;
        if (expMap[lib.id] === undefined) expMap[lib.id] = false;
      }
      setCollectionsByLibrary(colMap);
      setExpandedLibraries(expMap);
    } catch (err) {
      console.error("Failed to load libraries", err);
    }
  };

  useEffect(() => {
    loadData();

    // Listen for sidebar reload requests (e.g. after library/collection edit from App.tsx)
    const handleReload = () => loadData();
    window.addEventListener('reload-sidebar', handleReload);

    return () => {
      window.removeEventListener('reload-sidebar', handleReload);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("kintara.sidebar.expandedLibraries", JSON.stringify(expandedLibraries));
  }, [expandedLibraries]);

  useEffect(() => {
    localStorage.setItem("kintara.sidebar.myLibraries", String(ownedExpanded));
  }, [ownedExpanded]);

  useEffect(() => {
    localStorage.setItem("kintara.sidebar.sharedLibraries", String(sharedExpanded));
  }, [sharedExpanded]);

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

  const ownedLibraries = libraries.filter((library) => library.accessRole === "owner");
  const sharedLibraries = libraries.filter((library) => library.accessRole !== "owner");
  const openSettings = (type: "library" | "collection", id: number) => {
    window.dispatchEvent(new CustomEvent("open-entity-settings", { detail: { type, id } }));
  };

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

          {sidebarMessage && <p className="sidebar-feedback" role="alert">{sidebarMessage}</p>}

          <SidebarLibraryGroup
            title="My Libraries"
            libraries={ownedLibraries}
            collectionsByLibrary={collectionsByLibrary}
            expandedLibraries={expandedLibraries}
            expanded={ownedExpanded}
            activeView={activeView}
            onToggleGroup={() => setOwnedExpanded((value) => !value)}
            onToggleLibrary={toggleLibrary}
            onSelect={setActiveView}
            onCreateLibrary={() => openPrompt("Create Library", "Library name...", "", async (value) => {
              await libraryService.create({ name: value });
              await loadData();
            })}
            onImport={onImport}
            onOpenMenu={(event, library) => openRowMenu(event, library.id, library.name)}
            onAddDocument={(libraryId, documentId) => libraryService.addDocument(libraryId, documentId)}
            onAddToCollection={(collectionId, documentId) => collectionService.addDocument(collectionId, documentId)}
            onOpenSettings={openSettings}
            onError={setSidebarMessage}
          />

          <SidebarLibraryGroup
            title="Shared With Me"
            libraries={sharedLibraries}
            collectionsByLibrary={collectionsByLibrary}
            expandedLibraries={expandedLibraries}
            expanded={sharedExpanded}
            activeView={activeView}
            onToggleGroup={() => setSharedExpanded((value) => !value)}
            onToggleLibrary={toggleLibrary}
            onSelect={setActiveView}
            onImport={onImport}
            onOpenMenu={(event, library) => openRowMenu(event, library.id, library.name)}
            onAddDocument={(libraryId, documentId) => libraryService.addDocument(libraryId, documentId)}
            onAddToCollection={(collectionId, documentId) => collectionService.addDocument(collectionId, documentId)}
            onOpenSettings={openSettings}
            onError={setSidebarMessage}
          />
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
