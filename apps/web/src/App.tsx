import { useEffect, useRef, useState } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Columns
} from "lucide-react";
import "./App.css";
import {
  ApiError,
  collectionService,
  documentService,
  libraryService,
  type Collection,
  type Document,
  type Library,
} from "./api";
import { MarkdownReader } from "./components/MarkdownReader";
import { PdfReader } from "./components/PdfReader";
import { Sidebar } from "./components/Sidebar";
import { DocumentGrid } from "./components/DocumentGrid";
import { DetailsSidebar } from "./components/DetailsSidebar";
import { SettingsModal } from "./components/SettingsModal";
import { HelpModal } from "./components/HelpModal";
import { ImportModal } from "./components/ImportModal";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { LibrarySettingsModal } from "./components/LibrarySettingsModal";
import { TabBar } from "./components/TabBar";
import { useDocumentTabs } from "./hooks/useDocumentTabs";
import { loadSettings, saveSettings } from "./lib/settings";

type ViewType = 'all' | 'recent' | 'favorites' | 'library' | 'collection';
type ActiveView = { type: ViewType, id?: number };

function App() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [activeView, setActiveView] = useState<ActiveView>({ type: 'recent' });
  const [viewMode, setViewMode] = useState<'grid' | 'reading'>('grid');

  const {
    openTabs,
    activeTabIndex,
    setActiveTabIndex,
    isSplitView,
    splitRightTabIndex,
    setSplitRightTabIndex,
    activeDocument,
    openDocument,
    closeTab,
    closeTabForDocument,
    toggleSplitView,
    replaceDocument,
  } = useDocumentTabs();

  // Both panels are drawers below 900px, so starting them open would cover the
  // library on a phone.
  const isNarrow = () => typeof window !== "undefined" && window.innerWidth <= 900;
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(() => !isNarrow());
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [detailsDocument, setDetailsDocument] = useState<Document | null>(null);

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [importingDoc, setImportingDoc] = useState<Document | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Library / Collection settings modal
  const [isLibSettingsOpen, setIsLibSettingsOpen] = useState(false);
  const [libSettingsLibrary, setLibSettingsLibrary] = useState<Library | null>(null);
  const [libSettingsCollection, setLibSettingsCollection] = useState<Collection | null>(null);
  const [libSettingsMode, setLibSettingsMode] = useState<'library' | 'collection'>('library');

  // Theming is applied in main.tsx before the first render; this only decides
  // whether the onboarding overlay is due.
  useEffect(() => {
    if (!loadSettings().hasSeenOnboarding) setShowOnboarding(true);
  }, []);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'i':
            e.preventDefault();
            handleImport();
            break;
          case 'f':
            // focus search logic
            e.preventDefault();
            const searchInput = document.querySelector('.sidebar-content input[type="text"]') as HTMLInputElement;
            if (searchInput) {
              setIsLeftSidebarOpen(true);
              setTimeout(() => searchInput.focus(), 100);
            }
            break;
          case ',':
            e.preventDefault();
            setIsSettingsOpen(true);
            break;
          case 'w':
            e.preventDefault();
            if (viewMode === 'reading' && openTabs.length > 0) {
              if (closeTab(activeTabIndex)) setViewMode('grid');
            }
            break;
          case 'b':
            e.preventDefault();
            setIsLeftSidebarOpen(prev => !prev);
            break;
        }
      } else if (e.key === 'F1') {
        e.preventDefault();
        setIsHelpOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openTabs, activeTabIndex, viewMode]);

  // Listen for custom events from Sidebar
  useEffect(() => {
    const handleOpenSettings = () => setIsSettingsOpen(true);
    const handleOpenHelp = () => setIsHelpOpen(true);
    const handleEntitySettings = (e: Event) => {
      const detail = (e as CustomEvent<{ type: 'library' | 'collection'; id: number }>).detail;
      if (detail) openEntitySettings(detail.type, detail.id);
    };
    window.addEventListener('open-settings', handleOpenSettings);
    window.addEventListener('open-help', handleOpenHelp);
    window.addEventListener('open-entity-settings', handleEntitySettings);
    return () => {
      window.removeEventListener('open-settings', handleOpenSettings);
      window.removeEventListener('open-help', handleOpenHelp);
      window.removeEventListener('open-entity-settings', handleEntitySettings);
    };
  }, []);

  const loadDocuments = async () => {
    try {
      // Every view is the same endpoint with different filters now, rather than
      // a separate query per view.
      const query: Parameters<typeof documentService.list>[0] = {};
      const trimmed = searchQuery.trim();

      if (trimmed.length > 0) query.q = trimmed;

      // Searching happens *inside* the current view rather than replacing it,
      // so a library stays a library once you start typing. The server ANDs the
      // two, so both are sent together.
      if (activeView.type === 'recent') {
        // The exception. "Recent" is the last ten things, not a scope worth
        // searching within, so a query here searches everything.
        if (!trimmed) query.limit = 10;
      } else if (activeView.type === 'favorites') {
        query.favorite = true;
      } else if (activeView.type === 'library' && activeView.id) {
        query.libraryId = activeView.id;
      } else if (activeView.type === 'collection' && activeView.id) {
        query.collectionId = activeView.id;
      }

      const page = await documentService.list(query);
      setDocuments(page.items);
    } catch (err) {
      console.error("Failed to load documents", err);
    }
  };

  /**
   * Closes tabs whose document no longer exists.
   *
   * A file removed from the share is dropped by the scanner, but an open tab is
   * client state and knows nothing about it — leaving a tab that opens a reader
   * for a document that is gone. Only a definite 404 closes a tab; a network
   * blip must not throw away what someone was reading.
   */
  const reconcileTabs = async () => {
    for (const tab of openTabs) {
      try {
        await documentService.get(tab.id);
      } catch (err) {
        if (err instanceof ApiError && err.isNotFound) {
          if (closeTabForDocument(tab.id)) setViewMode('grid');
        }
      }
    }
  };

  useEffect(() => {
    loadDocuments();

    const handleRefresh = () => {
      loadDocuments();
      reconcileTabs();
    };
    window.addEventListener('refresh-documents', handleRefresh);
    return () => window.removeEventListener('refresh-documents', handleRefresh);
  }, [searchQuery, activeView]);

  // Checked when the view changes rather than on every keystroke, so typing in
  // the search box does not fire a request per open tab.
  useEffect(() => {
    reconcileTabs();
  }, [activeView]);

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    event.target.value = "";
    if (!file) return;

    setImportError(null);
    setIsUploading(true);
    try {
      // The upload happens before the modal because the server needs the bytes
      // to read metadata and render a cover; the modal then edits the result.
      setImportingDoc(await documentService.upload(file));
    } catch (err) {
      console.error("Failed to import document", err);
      setImportError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSidebarSelect = (view: ActiveView) => {
    setActiveView(view);
    // Choosing a view is a fresh start. Carrying the query over would make the
    // new library look empty for a reason that is off-screen on a phone.
    setSearchQuery("");
    setViewMode('grid');
    // On a phone the sidebar covers the library, so choosing a view should
    // reveal the result rather than leaving the drawer in the way.
    if (isNarrow()) setIsLeftSidebarOpen(false);
  };

  /**
   * Widens the current search to the whole library.
   *
   * Deliberately keeps the query — the point of the control is to run the same
   * search without its scope, not to start over. It also leaves the sidebar
   * open, because that is where the search box is.
   */
  const handleSearchEverywhere = () => {
    setActiveView({ type: 'all' });
    setViewMode('grid');
  };

  const openDetails = (doc: Document) => {
    setDetailsDocument(doc);
    setIsRightSidebarOpen(true);
  };

  const renderReaderContent = (doc: Document | null, inSplitView: boolean = false) => {
    if (!doc) return null;
    if (doc.documentType === 'md' || doc.documentType === 'txt') {
      return <MarkdownReader documentId={doc.id} />;
    }
    if (doc.documentType === 'pdf') {
      return <PdfReader documentId={doc.id} isSplitView={inSplitView} />;
    }
    return <div>Unsupported file format</div>;
  };

  const handleDocumentUpdate = () => {
    loadDocuments();

    // The details panel shows detailsDocument when one was picked from a card,
    // and otherwise falls back to the document open in the reader. Refreshing
    // only the former left the reader's copy stale, so edited metadata saved
    // correctly to the server and then appeared to vanish on reopening.
    const shown = detailsDocument ?? activeDocument;
    if (!shown) return;

    // One document by id, rather than listing the whole library to find it.
    documentService.get(shown.id).then(updated => {
      setDetailsDocument(prev => (prev ? updated : prev));
      replaceDocument(updated);
    }).catch(err => console.error("Failed to refresh document", err));
  };

  const handleDocumentDelete = () => {
    setIsRightSidebarOpen(false);
    setDetailsDocument(null);
    loadDocuments();
    // Close tab if open
    if (detailsDocument && closeTabForDocument(detailsDocument.id)) {
      setViewMode('grid');
    }
  };

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    saveSettings({ ...loadSettings(), hasSeenOnboarding: true });

    // Trigger prompt to rename first library
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('prompt-rename-first-library'));
    }, 400);
  };

  /**
   * Opens library or collection settings for a specific entity.
   *
   * Driven by the gear on each sidebar row rather than the active view, so a
   * library can be renamed without first navigating into it. Errors are caught
   * because an unhandled rejection in a click handler fails silently, which
   * reads as a button that does nothing.
   */
  const openEntitySettings = async (type: 'library' | 'collection', id: number) => {
    try {
      if (type === 'library') {
        const libs = await libraryService.list();
        const lib = libs.find(l => l.id === id) ?? null;
        if (!lib) return;
        setLibSettingsLibrary(lib);
        setLibSettingsCollection(null);
        setLibSettingsMode('library');
      } else {
        const col = await collectionService.get(id);
        if (!col) return;
        setLibSettingsCollection(col);
        setLibSettingsLibrary(null);
        setLibSettingsMode('collection');
      }
      setIsLibSettingsOpen(true);
    } catch (err) {
      console.error("Failed to open settings", err);
    }
  };

  const handleLibSettingsSaved = () => {
    window.dispatchEvent(new CustomEvent('reload-sidebar'));
  };

  const handleLibDeleted = () => {
    setActiveView({ type: 'recent' });
    setViewMode('grid');
    window.dispatchEvent(new CustomEvent('reload-sidebar'));
  };

  return (
    <div className="app-container font-sans text-primary bg-[var(--bg-primary)]">
      {showOnboarding && <OnboardingOverlay onComplete={handleOnboardingComplete} />}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      <LibrarySettingsModal
        isOpen={isLibSettingsOpen}
        mode={libSettingsMode}
        library={libSettingsLibrary}
        collection={libSettingsCollection}
        onClose={() => setIsLibSettingsOpen(false)}
        onSaved={handleLibSettingsSaved}
        onDeleted={handleLibDeleted}
      />
      {/* The browser's file picker replaces the desktop build's native dialog. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.md,.txt"
        className="hidden"
        onChange={handleFileSelected}
      />

      {isUploading && (
        <div className="fixed-overlay z-100" role="status" aria-live="polite">
          <div className="modal-content" style={{ maxWidth: "320px" }}>
            <div className="modal-body text-center">
              <p className="text-sm text-secondary m-0">Uploading and indexing…</p>
            </div>
          </div>
        </div>
      )}

      {importError && (
        <div className="fixed-overlay z-100" role="alertdialog" aria-modal="true">
          <div className="modal-content" style={{ maxWidth: "420px" }}>
            <div className="modal-header">
              <h2 className="font-semibold text-base m-0">Import failed</h2>
            </div>
            <div className="modal-body">
              <p className="text-sm text-secondary m-0">{importError}</p>
              <div className="flex justify-end mt-6">
                <button className="btn btn-primary" onClick={() => setImportError(null)} autoFocus>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {importingDoc && (
        <ImportModal
          document={importingDoc}
          onClose={() => setImportingDoc(null)} 
          onComplete={() => {
            setImportingDoc(null);
            loadDocuments();
          }} 
        />
      )}

      {/* Tapping outside a drawer closes it, which is the gesture people expect
          and the only way to dismiss it one-handed. */}
      {(isLeftSidebarOpen || isRightSidebarOpen) && (
        <div
          className="drawer-backdrop"
          onClick={() => {
            if (isNarrow()) {
              setIsLeftSidebarOpen(false);
              setIsRightSidebarOpen(false);
            }
          }}
          aria-hidden="true"
        />
      )}

      <Sidebar
        isOpen={isLeftSidebarOpen}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        activeView={activeView}
        setActiveView={handleSidebarSelect}
        onSearchEverywhere={handleSearchEverywhere}
        onImport={handleImport}
      />

      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top Header Bar */}
        <div className="h-12 border-b border-[var(--border-color)] bg-[var(--bg-primary)] flex items-center px-2 z-10 flex-shrink-0">
          <button 
            className="btn btn-ghost p-1.5 text-muted hover:text-primary mr-2 flex-shrink-0 rounded" 
            onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
            title={isLeftSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
          >
            {isLeftSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>


          <TabBar
            tabs={openTabs}
            activeIndex={activeTabIndex}
            isReading={viewMode === 'reading'}
            onSelect={(idx) => { setActiveTabIndex(idx); setViewMode('reading'); }}
            onClose={(idx) => { if (closeTab(idx)) setViewMode('grid'); }}
          />
          
          <div className="flex items-center gap-2 flex-shrink-0 ml-auto pr-2">
            {viewMode === 'reading' && isSplitView && splitRightTabIndex !== null && (
              <select 
                className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-primary rounded px-2 py-1 text-xs mr-2 cursor-pointer focus:outline-none focus:border-[var(--accent)] transition-all"
                value={splitRightTabIndex}
                onChange={(e) => setSplitRightTabIndex(Number(e.target.value))}
                title="Split View Document"
              >
                {openTabs.map((t, idx) => (
                  <option key={idx} value={idx}>{t.title}</option>
                ))}
              </select>
            )}
            {viewMode === 'reading' && (
              <button 
                className={`btn btn-ghost p-1.5 rounded ${isSplitView ? 'text-[var(--accent)] bg-[var(--accent)]/10' : 'text-muted hover:text-primary hover:bg-[var(--bg-tertiary)]'}`}
                onClick={toggleSplitView}
                title="Toggle Split View"
                disabled={openTabs.length === 0}
              >
                <Columns size={18} />
              </button>
            )}
            <button 
              className={`btn btn-ghost p-1.5 ml-1 rounded ${isRightSidebarOpen ? 'text-[var(--accent)] bg-[var(--accent)]/10' : 'text-muted hover:text-primary hover:bg-[var(--bg-tertiary)]'}`} 
              onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
              title={isRightSidebarOpen ? "Close Details" : "Open Details"}
            >
              {isRightSidebarOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>
          </div>
        </div>
        
        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden relative bg-[var(--bg-primary)]">
          {viewMode === 'grid' ? (
            <div className="w-full h-full animate-in fade-in duration-200">
              <DocumentGrid 
                documents={documents} 
                onOpenDocument={(doc) => {
                  openDocument(doc);
                  setViewMode('reading');
                }}
                onOpenDetails={openDetails}
                onRefresh={loadDocuments}
              />
            </div>
          ) : (
            <>
              {/* Left Reader Panel */}
              <div className={`flex-1 min-w-0 h-full w-full relative ${activeDocument?.documentType === 'pdf' ? 'bg-[var(--bg-secondary)]' : 'reader-bg'}`}>
                <div className="absolute inset-0 overflow-y-auto">
                  {renderReaderContent(activeDocument, isSplitView)}
                </div>
              </div>

              {isSplitView && splitRightTabIndex !== null && (
                <div className={`flex-1 min-w-0 border-l border-[var(--border-color)] h-full w-full relative ${openTabs[splitRightTabIndex]?.documentType === 'pdf' ? 'bg-[var(--bg-secondary)]' : 'reader-bg'}`}>
                  <div className="absolute inset-0 overflow-y-auto">
                    {renderReaderContent(openTabs[splitRightTabIndex] || null, true)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Right Sidebar (Details) */}
      {isRightSidebarOpen && (detailsDocument || activeDocument) ? (
        <DetailsSidebar 
          document={(detailsDocument || activeDocument)!} 
          onUpdate={handleDocumentUpdate}
          onDelete={handleDocumentDelete}
        />
      ) : isRightSidebarOpen && !(detailsDocument || activeDocument) ? (
         <aside className="inspector-pane flex-shrink-0 w-80 bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col h-full items-center justify-center text-center p-6">
            <PanelRightOpen size={32} className="text-muted mb-4 opacity-50" />
            <p className="text-sm text-muted">Select a document's details button to view and edit its metadata.</p>
         </aside>
      ) : null}
    </div>
  );
}

export default App;
