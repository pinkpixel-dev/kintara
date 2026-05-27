import { useState, useEffect } from "react";
import { 
  Folder, 
  FileText, 
  Search, 
  Settings, 
  Library,
  Star,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  X,
  Columns
} from "lucide-react";
import "./App.css";
import { documentService, workspaceService, Document, Workspace } from "./db";
import { MarkdownReader } from "./components/MarkdownReader";
import { PdfReader } from "./components/PdfReader";

function App() {
  const [activeTab, setActiveTab] = useState("library");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Phase 2: Workspaces
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);

  // Phase 2: Tabs & Split View
  const [openTabs, setOpenTabs] = useState<Document[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(0);
  const [isSplitView, setIsSplitView] = useState(false);
  const [splitRightTabIndex, setSplitRightTabIndex] = useState<number | null>(null);

  // Sidebar state
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);

  useEffect(() => {
    const initWorkspaces = async () => {
      try {
        let ws = await workspaceService.getAll();
        if (ws.length === 0) {
          // Create default workspace
          await workspaceService.create("Research", "#410186");
          ws = await workspaceService.getAll();
        }
        setWorkspaces(ws);
        if (ws.length > 0) setActiveWorkspace(ws[0]);
      } catch (err) {
        console.error("Failed to load workspaces", err);
      }
    };
    initWorkspaces();
  }, []);

  const loadDocuments = async () => {
    try {
      if (searchQuery.trim().length > 0) {
        const docs = await documentService.search(searchQuery);
        setDocuments(docs);
      } else {
        const docs = await documentService.getAll();
        setDocuments(docs);
      }
    } catch (err) {
      console.error("Failed to load documents", err);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [searchQuery, activeWorkspace]);

  const handleImport = async () => {
    try {
      const newDoc = await documentService.importDocument();
      if (newDoc) {
        setDocuments(prev => [newDoc, ...prev]);
        openDocumentInTab(newDoc);
        if (activeWorkspace) {
          await workspaceService.addDocument(activeWorkspace.id, newDoc.id);
        }
      }
    } catch (err) {
      alert(`Import failed in App: ${err}`);
      console.error("Failed to import document", err);
    }
  };

  const openDocumentInTab = (doc: Document) => {
    const existingIndex = openTabs.findIndex(t => t.id === doc.id);
    if (existingIndex >= 0) {
      setActiveTabIndex(existingIndex);
    } else {
      setOpenTabs(prev => [...prev, doc]);
      setActiveTabIndex(openTabs.length); // length before adding represents the new index
    }
  };

  const closeTab = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    const newTabs = [...openTabs];
    newTabs.splice(index, 1);
    setOpenTabs(newTabs);
    
    if (activeTabIndex >= newTabs.length) {
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
      // Try to open the last tab on the right, or default to the current active
      setSplitRightTabIndex(activeTabIndex);
    }
  };

  const activeDocument = openTabs.length > 0 ? openTabs[activeTabIndex] : null;

  const renderReaderContent = (doc: Document | null) => {
    if (!doc) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <h1>Welcome to Kintara</h1>
          <img src="/logo.png" alt="Kintara Logo" style={{ width: '300px', marginBottom: '2rem', marginTop: '1rem' }} />
          <p className="mt-8 text-sm text-muted">
            Select a document from the sidebar to open a tab, or click Import.
          </p>
          <button className="btn btn-primary mt-6" onClick={handleImport}>
            <Plus size={16} className="mr-2" />
            Import Document
          </button>
        </div>
      );
    }

    if (doc.document_type === 'md' || doc.document_type === 'txt') {
      return <MarkdownReader documentId={doc.id} filePath={doc.file_path} />;
    }

    if (doc.document_type === 'pdf') {
      return <PdfReader documentId={doc.id} filePath={doc.file_path} />;
    }

    return <div>Unsupported file format</div>;
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      {isLeftSidebarOpen && (
        <aside className="sidebar transition-all duration-300 flex-shrink-0">
          <div className="sidebar-header flex justify-between items-center">
            <div className="flex items-center">
              <img src="/logo.png" alt="Kintara Logo" className="mr-2" style={{ width: '50px', height: '50px' }} />
              <span className="font-bold text-lg text-white">Kintara</span>
            </div>
            <button className="btn btn-ghost p-1" onClick={handleImport} title="Import Document">
              <Plus size={18} />
            </button>
          </div>

          <div className="px-3 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
            <select 
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-primary text-sm rounded-md px-2 py-1.5 focus:outline-none focus:border-[var(--accent)] transition-all cursor-pointer"
              value={activeWorkspace?.id || ''}
              onChange={(e) => setActiveWorkspace(workspaces.find(w => w.id === Number(e.target.value)) || null)}
            >
              {workspaces.map(w => (
                <option key={w.id} value={w.id}>{w.name} Workspace</option>
              ))}
            </select>
          </div>
          
          <div className="sidebar-content">
            <div className="mb-6 relative">
              <Search className="absolute left-3 top-2.5 text-muted" size={16} />
              <input 
                type="text" 
                placeholder="Search documents..." 
                className="input pl-9 text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="text-xs uppercase text-muted mb-2 font-semibold">Collections</div>
            <div 
              className={`sidebar-item ${activeTab === 'library' ? 'active' : ''}`}
              onClick={() => setActiveTab('library')}
            >
              <Library /> All Documents
            </div>
            <div 
              className={`sidebar-item ${activeTab === 'recent' ? 'active' : ''}`}
              onClick={() => setActiveTab('recent')}
            >
              <FileText /> Recent
            </div>
            <div 
              className={`sidebar-item ${activeTab === 'favorites' ? 'active' : ''}`}
              onClick={() => setActiveTab('favorites')}
            >
              <Star /> Favorites
            </div>

            <div className="text-xs uppercase text-muted mt-6 mb-2 font-semibold">My Documents</div>
            <div className="flex flex-col gap-1 mt-2">
              {documents.length === 0 ? (
                <div className="text-sm text-muted px-3 py-2 italic">No documents yet</div>
              ) : (
                documents.map(doc => (
                  <div 
                    key={doc.id}
                    className={`sidebar-item text-sm py-1.5 ${activeDocument?.id === doc.id ? 'active' : ''}`}
                    onClick={() => openDocumentInTab(doc)}
                    title={doc.title}
                  >
                    <FileText size={14} className="mr-2 min-w-[14px]" />
                    <span className="truncate">{doc.title}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      )}

      {/* Main Reader View */}
      <main className="reader-pane transition-all duration-300 flex-1 flex flex-col min-w-0">
        <div className="reader-header px-2 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-1 w-full overflow-x-auto">
            <button 
              className="btn btn-ghost p-1 text-muted hover:text-primary mr-2 flex-shrink-0" 
              onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
              title={isLeftSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
            >
              {isLeftSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>

            {/* VS Code Style Tabs */}
            <div className="flex flex-1 overflow-x-auto no-scrollbar items-center">
              {openTabs.map((tab, idx) => (
                <div 
                  key={`${tab.id}-${idx}`}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-r border-[var(--border-color)] text-sm max-w-[200px] ${idx === activeTabIndex ? 'bg-[var(--bg-primary)] border-t-2 border-t-[var(--accent)] font-medium text-primary' : 'bg-[var(--bg-secondary)] text-secondary hover:bg-[var(--bg-tertiary)]'}`}
                  onClick={() => setActiveTabIndex(idx)}
                >
                  <FileText size={14} className="text-muted flex-shrink-0" />
                  <span className="truncate select-none">{tab.title}</span>
                  <button 
                    className="p-0.5 rounded-sm hover:bg-[var(--bg-tertiary)] text-muted flex-shrink-0"
                    onClick={(e) => closeTab(e, idx)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            
            <div className="flex items-center gap-2 flex-shrink-0 ml-auto pr-2">
              {isSplitView && splitRightTabIndex !== null && (
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
              <button 
                className={`btn btn-ghost p-1 ${isSplitView ? 'text-[var(--accent)]' : 'text-muted'}`}
                onClick={toggleSplitView}
                title="Toggle Split View"
                disabled={openTabs.length === 0}
              >
                <Columns size={18} />
              </button>
              <button 
                className="btn btn-ghost p-1 text-muted hover:text-primary ml-1" 
                onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
                title={isRightSidebarOpen ? "Close Inspector" : "Open Inspector"}
              >
                {isRightSidebarOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </button>
            </div>
          </div>
        </div>
        
        <div className="flex-1 flex overflow-hidden">
          {/* Left Reader Panel */}
          <div className="flex-1 min-w-0 overflow-y-auto relative h-full w-full">
            <div className="reader-content">
              {renderReaderContent(activeDocument)}
            </div>
          </div>

          {/* Right Reader Panel (Split View) */}
          {isSplitView && splitRightTabIndex !== null && (
            <div className="flex-1 min-w-0 overflow-y-auto border-l border-[var(--border-color)] relative h-full bg-[var(--bg-primary)] w-full">
              <div className="reader-content">
                {renderReaderContent(openTabs[splitRightTabIndex] || null)}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Inspector View */}
      {isRightSidebarOpen && (
        <aside className="inspector-pane transition-all duration-300 flex-shrink-0">
          <div className="inspector-header">
            Inspector
          </div>
          <div className="inspector-content">
            {activeDocument ? (
              <>
                <div className="metadata-field">
                  <div className="metadata-label">File Info</div>
                  <div className="metadata-value break-words" title={activeDocument.title}>{activeDocument.title}</div>
                  <div className="metadata-value text-muted text-xs uppercase mt-1">{activeDocument.document_type} Document</div>
                </div>
                
                <div className="metadata-field mt-4">
                  <div className="metadata-label">Tags</div>
                  <div className="flex gap-1 flex-wrap mt-1">
                    <span className="px-2 py-1 bg-[var(--bg-tertiary)] rounded-full text-xs">draft</span>
                  </div>
                </div>

                <div className="metadata-field mt-6">
                  <div className="metadata-label">Notes</div>
                  <textarea 
                    className="input mt-1" 
                    rows={6} 
                    placeholder="Add reading notes here..."
                    defaultValue=""
                  />
                </div>
                
                <div className="metadata-field mt-6">
                  <div className="metadata-label text-[var(--accent)] font-semibold">Linked Mentions</div>
                  <div className="text-xs text-secondary mt-1 italic">Backlinks feature is being initialized...</div>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted text-center mt-8">
                Select a document to view its metadata and notes.
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

export default App;
