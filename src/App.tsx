import { useState, useEffect } from "react";
import { 
  FileText, 
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  X,
  Columns
} from "lucide-react";
import "./App.css";
import { documentService, libraryService, collectionService, Document } from "./db";
import { MarkdownReader } from "./components/MarkdownReader";
import { PdfReader } from "./components/PdfReader";
import { Sidebar } from "./components/Sidebar";
import { DocumentGrid } from "./components/DocumentGrid";
import { DetailsSidebar } from "./components/DetailsSidebar";
import { SettingsModal, defaultSettings } from "./components/SettingsModal";
import { HelpModal } from "./components/HelpModal";
import { ImportModal } from "./components/ImportModal";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { BaseDirectory, readTextFile, exists } from "@tauri-apps/plugin-fs";

type ViewType = 'all' | 'recent' | 'favorites' | 'library' | 'collection';
type ActiveView = { type: ViewType, id?: number };

function App() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [activeView, setActiveView] = useState<ActiveView>({ type: 'recent' });
  const [viewMode, setViewMode] = useState<'grid' | 'reading'>('grid');

  const [openTabs, setOpenTabs] = useState<Document[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(0);
  const [isSplitView, setIsSplitView] = useState(false);
  const [splitRightTabIndex, setSplitRightTabIndex] = useState<number | null>(null);

  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [detailsDocument, setDetailsDocument] = useState<Document | null>(null);

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [importingDoc, setImportingDoc] = useState<Document | null>(null);

  // Load app settings on mount
  useEffect(() => {
    const initApp = async () => {
      try {
        let currentSettings = { ...defaultSettings };
        if (await exists('settings.json', { baseDir: BaseDirectory.AppLocalData })) {
          const data = await readTextFile('settings.json', { baseDir: BaseDirectory.AppLocalData });
          currentSettings = { ...defaultSettings, ...JSON.parse(data) };
        }
        
        // Apply theme and fonts
        document.documentElement.style.setProperty('--font-family', currentSettings.fontFamily);
        document.documentElement.style.fontSize = currentSettings.fontSize;
        if (currentSettings.theme !== 'system') {
          document.documentElement.setAttribute('data-theme', currentSettings.theme);
        } else {
          document.documentElement.removeAttribute('data-theme');
        }
        if (currentSettings.readerTheme) {
          document.documentElement.setAttribute('data-reader-theme', currentSettings.readerTheme);
        }

        if (!currentSettings.hasSeenOnboarding) {
          setShowOnboarding(true);
        }
      } catch (err) {
        console.error("Failed to init app settings", err);
      }
    };
    initApp();
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
              closeTab(e as any, activeTabIndex);
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
    window.addEventListener('open-settings', handleOpenSettings);
    window.addEventListener('open-help', handleOpenHelp);
    return () => {
      window.removeEventListener('open-settings', handleOpenSettings);
      window.removeEventListener('open-help', handleOpenHelp);
    };
  }, []);

  const loadDocuments = async () => {
    try {
      if (searchQuery.trim().length > 0) {
        const docs = await documentService.search(searchQuery);
        setDocuments(docs);
        return;
      }
      
      let docs: Document[] = [];
      if (activeView.type === 'all') {
        docs = await documentService.getAll();
      } else if (activeView.type === 'recent') {
        docs = await documentService.getRecent();
      } else if (activeView.type === 'favorites') {
        docs = await documentService.getFavorites();
      } else if (activeView.type === 'library' && activeView.id) {
        docs = await libraryService.getDocuments(activeView.id);
      } else if (activeView.type === 'collection' && activeView.id) {
        docs = await collectionService.getDocuments(activeView.id);
      } else {
        docs = await documentService.getAll();
      }
      setDocuments(docs);
    } catch (err) {
      console.error("Failed to load documents", err);
    }
  };

  useEffect(() => {
    loadDocuments();
    
    const handleRefresh = () => loadDocuments();
    window.addEventListener('refresh-documents', handleRefresh);
    return () => window.removeEventListener('refresh-documents', handleRefresh);
  }, [searchQuery, activeView]);

  const handleImport = async () => {
    try {
      const newDoc = await documentService.importDocument();
      if (newDoc) {
        setImportingDoc(newDoc);
      }
    } catch (err) {
      alert(`Import failed in App: ${err}`);
      console.error("Failed to import document", err);
    }
  };

  const handleSidebarSelect = (view: ActiveView) => {
    setActiveView(view);
    setViewMode('grid');
  };

  const openDocumentInTab = (doc: Document) => {
    const existingIndex = openTabs.findIndex(t => t.id === doc.id);
    if (existingIndex >= 0) {
      setActiveTabIndex(existingIndex);
    } else {
      setOpenTabs(prev => [...prev, doc]);
      setActiveTabIndex(openTabs.length);
    }
    setViewMode('reading');
  };

  const openDetails = (doc: Document) => {
    setDetailsDocument(doc);
    setIsRightSidebarOpen(true);
  };

  const closeTab = (e: React.MouseEvent, index: number) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const newTabs = [...openTabs];
    newTabs.splice(index, 1);
    setOpenTabs(newTabs);
    
    if (newTabs.length === 0) {
      setViewMode('grid');
    } else if (activeTabIndex >= newTabs.length) {
      setActiveTabIndex(Math.max(0, newTabs.length - 1));
    } else if (activeTabIndex > index) {
      setActiveTabIndex(activeTabIndex - 1);
    }

    if (isSplitView && splitRightTabIndex === index) {
      setIsSplitView(false);
      setSplitRightTabIndex(null);
    } else if (splitRightTabIndex !== null && splitRightTabIndex > index) {
      setSplitRightTabIndex(splitRightTabIndex - 1);
    }
  };

  const toggleSplitView = () => {
    if (isSplitView) {
      setIsSplitView(false);
      setSplitRightTabIndex(null);
    } else {
      setIsSplitView(true);
      setSplitRightTabIndex(activeTabIndex);
    }
  };

  const activeDocument = openTabs.length > 0 ? openTabs[activeTabIndex] : null;

  const renderReaderContent = (doc: Document | null) => {
    if (!doc) return null;
    if (doc.document_type === 'md' || doc.document_type === 'txt') {
      return <MarkdownReader documentId={doc.id} filePath={doc.file_path} />;
    }
    if (doc.document_type === 'pdf') {
      return <PdfReader documentId={doc.id} filePath={doc.file_path} />;
    }
    return <div>Unsupported file format</div>;
  };

  const handleDocumentUpdate = () => {
    loadDocuments();
    // Update open tabs if modified
    if (detailsDocument) {
      documentService.getAll().then(allDocs => {
        const updatedDoc = allDocs.find(d => d.id === detailsDocument.id);
        if (updatedDoc) {
          setDetailsDocument(updatedDoc);
          setOpenTabs(prev => prev.map(t => t.id === updatedDoc.id ? updatedDoc : t));
        }
      });
    }
  };

  const handleDocumentDelete = () => {
    setIsRightSidebarOpen(false);
    setDetailsDocument(null);
    loadDocuments();
    // Close tab if open
    if (detailsDocument) {
      const idx = openTabs.findIndex(t => t.id === detailsDocument.id);
      if (idx !== -1) {
        closeTab({ stopPropagation: () => {} } as any, idx);
      }
    }
  };

  const handleOnboardingComplete = async () => {
    setShowOnboarding(false);
    try {
      let currentSettings = { ...defaultSettings };
      if (await exists('settings.json', { baseDir: BaseDirectory.AppLocalData })) {
        const data = await readTextFile('settings.json', { baseDir: BaseDirectory.AppLocalData });
        currentSettings = { ...currentSettings, ...JSON.parse(data) };
      }
      
      currentSettings.hasSeenOnboarding = true;
      const { writeTextFile, mkdir } = await import("@tauri-apps/plugin-fs");
      
      const hasDir = await exists('', { baseDir: BaseDirectory.AppLocalData });
      if (!hasDir) {
        await mkdir('', { baseDir: BaseDirectory.AppLocalData, recursive: true });
      }
      
      await writeTextFile('settings.json', JSON.stringify(currentSettings, null, 2), { baseDir: BaseDirectory.AppLocalData });
      
      // Trigger prompt to rename first library
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('prompt-rename-first-library'));
      }, 400);
      
    } catch (err) {
      console.error("Failed to save onboarding completion", err);
    }
  };

  return (
    <div className="app-container font-sans text-primary bg-[var(--bg-primary)]">
      {showOnboarding && <OnboardingOverlay onComplete={handleOnboardingComplete} />}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
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

      <Sidebar 
        isOpen={isLeftSidebarOpen}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        activeView={activeView}
        setActiveView={handleSidebarSelect}
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

          {/* Tabs Area */}
          <div className="flex flex-1 overflow-x-auto no-scrollbar items-center h-full">
            {openTabs.map((tab, idx) => (
              <div 
                key={`${tab.id}-${idx}`}
                className={`flex items-center gap-2 px-4 h-full cursor-pointer border-r border-[var(--border-color)] text-sm max-w-[200px] transition-colors
                  ${viewMode === 'reading' && idx === activeTabIndex 
                    ? 'bg-[var(--bg-primary)] border-t-3 border-t-[var(--accent)] text-primary font-medium' 
                    : 'bg-[var(--bg-secondary)] text-secondary border-t-3 border-t-transparent hover:bg-[var(--bg-tertiary)]'
                  }`}
                onClick={() => { setActiveTabIndex(idx); setViewMode('reading'); }}
              >
                <FileText size={14} className={viewMode === 'reading' && idx === activeTabIndex ? "text-primary" : "text-muted"} />
                <span className="truncate select-none">{tab.title}</span>
                <button 
                  className="p-1 rounded hover:bg-black/10 text-muted ml-1"
                  onClick={(e) => closeTab(e, idx)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          
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
                onOpenDocument={openDocumentInTab}
                onOpenDetails={openDetails}
                onRefresh={loadDocuments}
              />
            </div>
          ) : (
            <>
              {/* Left Reader Panel */}
              <div className={`flex-1 min-w-0 h-full w-full relative ${activeDocument?.document_type === 'pdf' ? 'bg-[var(--bg-secondary)]' : 'reader-bg'}`}>
                <div className="absolute inset-0 overflow-y-auto">
                  {renderReaderContent(activeDocument)}
                </div>
              </div>

              {/* Right Reader Panel (Split View) */}
              {isSplitView && splitRightTabIndex !== null && (
                <div className={`flex-1 min-w-0 border-l border-[var(--border-color)] h-full w-full relative ${openTabs[splitRightTabIndex]?.document_type === 'pdf' ? 'bg-[var(--bg-secondary)]' : 'reader-bg'}`}>
                  <div className="absolute inset-0 overflow-y-auto">
                    {renderReaderContent(openTabs[splitRightTabIndex] || null)}
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
