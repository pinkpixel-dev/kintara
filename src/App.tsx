import { useState, useEffect } from "react";
import { 
  Folder, 
  FileText, 
  Search, 
  Settings, 
  Library,
  Star,
  Tag,
  Plus
} from "lucide-react";
import "./App.css";
import { documentService, Document } from "./db";
import { MarkdownReader } from "./components/MarkdownReader";
import { PdfReader } from "./components/PdfReader";

function App() {
  const [activeTab, setActiveTab] = useState("library");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [activeDocument, setActiveDocument] = useState<Document | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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
  }, [searchQuery]);

  const handleImport = async () => {
    try {
      const newDoc = await documentService.importDocument();
      if (newDoc) {
        setDocuments(prev => [newDoc, ...prev]);
        setActiveDocument(newDoc);
      }
    } catch (err) {
      console.error("Failed to import document", err);
    }
  };

  const renderReaderContent = () => {
    if (!activeDocument) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <h1>Welcome to Kintara</h1>
          <img src="/logo.png" alt="Kintara Logo" style={{ width: '150px', marginBottom: '2rem' }} />
          <p className="mt-8 text-sm text-muted">
            Select a document from the sidebar to begin reading, or click Import to add a new document.
          </p>
          <button className="btn btn-primary mt-6" onClick={handleImport}>
            <Plus size={16} className="mr-2" />
            Import Document
          </button>
        </div>
      );
    }

    if (activeDocument.document_type === 'md' || activeDocument.document_type === 'txt') {
      return <MarkdownReader filePath={activeDocument.file_path} />;
    }

    if (activeDocument.document_type === 'pdf') {
      return <PdfReader filePath={activeDocument.file_path} />;
    }

    return <div>Unsupported file format</div>;
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header flex justify-between items-center">
          <div className="flex items-center">
            <Library className="mr-2" size={20} color="var(--accent)" />
            <span>Kintara</span>
          </div>
          <button className="btn btn-ghost p-1" onClick={handleImport} title="Import Document">
            <Plus size={18} />
          </button>
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
                  onClick={() => setActiveDocument(doc)}
                  title={doc.title}
                >
                  <FileText size={14} className="mr-2 min-w-[14px]" />
                  <span className="truncate">{doc.title}</span>
                </div>
              ))
            )}
          </div>

          <div className="text-xs uppercase text-muted mt-6 mb-2 font-semibold">Tools</div>
          <div className="sidebar-item">
            <Search /> Search
          </div>
          <div className="sidebar-item">
            <Settings /> Settings
          </div>
        </div>
      </aside>

      {/* Main Reader View */}
      <main className="reader-pane">
        <div className="reader-header">
          <div className="font-medium text-sm text-secondary truncate max-w-[60%]">
            {activeDocument ? `library / ${activeDocument.title}.${activeDocument.document_type}` : ''}
          </div>
          <div className="flex gap-2">
            {activeDocument && (
              <>
                <button className="btn btn-ghost">Edit</button>
                <button className="btn btn-primary">Share</button>
              </>
            )}
          </div>
        </div>
        
        <div className="reader-content h-full">
          {renderReaderContent()}
        </div>
      </main>

      {/* Inspector View */}
      <aside className="inspector-pane">
        <div className="inspector-header">
          Inspector
        </div>
        <div className="inspector-content">
          {activeDocument ? (
            <>
              <div className="metadata-field">
                <div className="metadata-label">File Info</div>
                <div className="metadata-value truncate" title={activeDocument.title}>{activeDocument.title}</div>
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
            </>
          ) : (
            <div className="text-sm text-muted text-center mt-8">
              Select a document to view its metadata and notes.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default App;
