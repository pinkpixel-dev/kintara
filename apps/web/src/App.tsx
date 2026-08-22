import { useEffect, useState } from "react";
import "./App.css";
import "./components/Ai.css";
import { ApiError, aiService, documentService, type Document } from "./api";
import { Sidebar } from "./components/Sidebar";
import { DocumentGrid } from "./components/DocumentGrid";
import { emptyReasonFor, type ActiveView } from "./lib/empty-reason";
import { DetailsSidebar } from "./components/DetailsSidebar";
import { SettingsModal } from "./components/SettingsModal";
import { HelpModal } from "./components/HelpModal";
import { ImportModal } from "./components/ImportModal";
import { BulkImportModal } from "./components/BulkImportModal";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { LibrarySettingsModal } from "./components/LibrarySettingsModal";
import { AppHeader } from "./components/AppHeader";
import { ReaderPanes } from "./components/ReaderPanes";
import { MoveDocumentModal } from "./components/MoveDocumentModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ImportOverlays } from "./components/ImportOverlays";
import { AiPanel } from "./components/AiPanel";
import { useDocumentTabs } from "./hooks/useDocumentTabs";
import { useDocumentImport } from "./hooks/useDocumentImport";
import { useEntitySettings } from "./hooks/useEntitySettings";
import { loadSettings, saveSettings } from "./lib/settings";


function App() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [activeView, setActiveView] = useState<ActiveView>({ type: 'recent' });
  // Reported by the sidebar, which owns the libraries and collections and so is
  // the only place that can name the scope a search is running inside.
  const [scopeName, setScopeName] = useState<string | null>(null);
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
  // The details panel is open exactly when there is a document to show in it.
  // It used to be a separate toggle, which meant the two could disagree — the
  // panel could be "open" over nothing, or hold a document while closed.
  const [detailsDocument, setDetailsDocument] = useState<Document | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(false);

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [movingDocument, setMovingDocument] = useState<Document | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Document | null>(null);

  const importFlow = useDocumentImport();

  const entitySettings = useEntitySettings();

  // Theming is applied in main.tsx before the first render; this only decides
  // whether the onboarding overlay is due.
  useEffect(() => {
    if (!loadSettings().hasSeenOnboarding) setShowOnboarding(true);
    aiService.settings().then((value) => setAiEnabled(value.enabled)).catch(() => undefined);
  }, []);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'i':
            e.preventDefault();
            importFlow.start();
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
      if (detail) entitySettings.open(detail.type, detail.id);
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

  const openDetails = (doc: Document) => setDetailsDocument(doc);

  const handleDocumentUpdate = () => {
    loadDocuments();

    // The reader's copy of the document has to be refreshed too, not just the
    // panel's. Refreshing only the panel left the tab stale, so edited metadata
    // saved correctly to the server and then appeared to vanish on reopening.
    const shown = detailsDocument;
    if (!shown) return;

    // One document by id, rather than listing the whole library to find it.
    documentService.get(shown.id).then(updated => {
      setDetailsDocument(prev => (prev ? updated : prev));
      replaceDocument(updated);
    }).catch(err => console.error("Failed to refresh document", err));
  };

  /**
   * Favourites the document open in the reader.
   *
   * The tab's copy is replaced from the response rather than refetched, so the
   * star in the header reflects the change without a round trip through the
   * grid.
   */
  const toggleFavorite = async (doc: Document) => {
    try {
      await documentService.setFavorite(doc.id, !doc.isFavorite);
      const updated = await documentService.get(doc.id);
      replaceDocument(updated);
      setDetailsDocument(prev => (prev && prev.id === doc.id ? updated : prev));
      loadDocuments();
    } catch (err) {
      console.error("Failed to update favorite", err);
    }
  };

  /** Deletes the document open in the reader, once confirmed. */
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const doc = pendingDelete;
    setPendingDelete(null);
    try {
      await documentService.remove(doc.id);
      if (closeTabForDocument(doc.id)) setViewMode('grid');
      if (detailsDocument?.id === doc.id) setDetailsDocument(null);
      loadDocuments();
    } catch (err) {
      console.error("Failed to delete document", err);
    }
  };

  const handleDocumentDelete = () => {
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
    <div className="app-container text-primary bg-[var(--bg-primary)]">
      {showOnboarding && <OnboardingOverlay onComplete={handleOnboardingComplete} />}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onAiEnabledChange={(enabled) => { setAiEnabled(enabled); if (!enabled) setIsAiOpen(false); }} />
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      <LibrarySettingsModal
        isOpen={entitySettings.isOpen}
        mode={entitySettings.mode}
        library={entitySettings.library}
        collection={entitySettings.collection}
        onClose={entitySettings.close}
        onSaved={handleLibSettingsSaved}
        onDeleted={handleLibDeleted}
      />
      <ImportOverlays
        fileInputRef={importFlow.fileInputRef}
        onFileSelected={importFlow.handleFileSelected}
        isUploading={importFlow.isUploading}
        error={importFlow.error}
        onDismissError={importFlow.dismissError}
      />

      {movingDocument && (
        <MoveDocumentModal
          document={movingDocument}
          // Only a library or collection view gives it somewhere to be moved
          // out of; from Recent or All Documents there is nothing to remove.
          scope={
            (activeView.type === 'library' || activeView.type === 'collection') && activeView.id
              ? { type: activeView.type, id: activeView.id }
              : undefined
          }
          onClose={() => setMovingDocument(null)}
          onMoved={() => {
            setMovingDocument(null);
            loadDocuments();
            window.dispatchEvent(new CustomEvent('reload-sidebar'));
          }}
        />
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete document"
        message={
          pendingDelete
            ? `"${pendingDelete.title}" and its file will be permanently removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {importFlow.bulkFiles && (
        <BulkImportModal
          files={importFlow.bulkFiles}
          defaultLibraryId={importFlow.target?.libraryId}
          defaultCollectionId={importFlow.target?.collectionId}
          onClose={importFlow.finish}
          onComplete={() => {
            importFlow.finish();
            loadDocuments();
            // A new library may have been created from inside the modal.
            window.dispatchEvent(new CustomEvent('reload-sidebar'));
          }}
        />
      )}

      {importFlow.importingDoc && (
        <ImportModal
          document={importFlow.importingDoc}
          defaultLibraryId={importFlow.target?.libraryId}
          defaultCollectionId={importFlow.target?.collectionId}
          onClose={importFlow.finish}
          onComplete={() => {
            importFlow.finish();
            loadDocuments();
            // A new library may have been created from inside the modal.
            window.dispatchEvent(new CustomEvent('reload-sidebar'));
          }}
        />
      )}

      {/* Tapping outside a drawer closes it, which is the gesture people expect
          and the only way to dismiss it one-handed. */}
      {(isLeftSidebarOpen || detailsDocument || isAiOpen) && (
        <div
          className="drawer-backdrop"
          onClick={() => {
            if (isNarrow()) {
              setIsLeftSidebarOpen(false);
              setDetailsDocument(null);
              setIsAiOpen(false);
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
        onScopeNameChange={setScopeName}
        onImport={importFlow.start}
      />

      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <AppHeader
          tabs={openTabs}
          activeTabIndex={activeTabIndex}
          activeDocument={activeDocument}
          isReading={viewMode === 'reading'}
          isSplitView={isSplitView}
          splitRightTabIndex={splitRightTabIndex}
          isLeftSidebarOpen={isLeftSidebarOpen}
          aiEnabled={aiEnabled}
          isAiOpen={isAiOpen}
          onSelectTab={(idx) => { setActiveTabIndex(idx); setViewMode('reading'); }}
          onCloseTab={(idx) => { if (closeTab(idx)) setViewMode('grid'); }}
          onSetSplitRightTab={setSplitRightTabIndex}
          onToggleSplitView={toggleSplitView}
          onToggleLeftSidebar={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
          onOpenDetails={openDetails}
          onToggleFavorite={toggleFavorite}
          onMove={setMovingDocument}
          onDelete={setPendingDelete}
          onToggleAi={() => { setIsAiOpen((open) => !open); setDetailsDocument(null); }}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden relative bg-[var(--bg-primary)]">
          {viewMode === 'grid' ? (
            <div className="w-full h-full animate-in fade-in duration-200">
              <DocumentGrid
                documents={documents}
                emptyReason={emptyReasonFor(searchQuery, activeView, scopeName)}
                onOpenDocument={(doc) => {
                  openDocument(doc);
                  setViewMode('reading');
                }}
                onOpenDetails={openDetails}
                onMove={setMovingDocument}
                onRefresh={loadDocuments}
                onSearchEverywhere={handleSearchEverywhere}
                onImport={() => importFlow.start()}
              />
            </div>
          ) : (
            <ReaderPanes
              activeDocument={activeDocument}
              splitDocument={splitRightTabIndex !== null ? openTabs[splitRightTabIndex] ?? null : null}
              isSplitView={isSplitView}
            />
          )}
        </div>
      </main>

      {/* Details, for the one document that was asked about. There is no
          empty state any more: without a toggle there is no way to open this
          without choosing a document first. */}
      {detailsDocument && (
        <DetailsSidebar
          document={detailsDocument}
          onUpdate={handleDocumentUpdate}
          onDelete={handleDocumentDelete}
          onClose={() => setDetailsDocument(null)}
        />
      )}
      {isAiOpen && <AiPanel document={viewMode === "reading" ? activeDocument : null} onClose={() => setIsAiOpen(false)} onUpdated={(updated) => { replaceDocument(updated); setDocuments((items) => items.map((item) => item.id === updated.id ? updated : item)); }} />}
    </div>
  );
}

export default App;
