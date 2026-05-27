import { useState, useEffect } from "react";
import { Document, documentService, tagService, Tag } from "../db";
import { Trash2, Save, Image as ImageIcon } from "lucide-react";

interface DetailsSidebarProps {
  document: Document;
  onUpdate: () => void;
  onDelete: () => void;
}

export function DetailsSidebar({ document, onUpdate, onDelete }: DetailsSidebarProps) {
  const [docState, setDocState] = useState<Document>(document);
  const [isSaving, setIsSaving] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    setDocState(document);
    loadTags(document.id);
  }, [document]);

  const loadTags = async (docId: number) => {
    try {
      const docTags = await tagService.getForDocument(docId);
      setTags(docTags);
    } catch (err) {
      console.error("Failed to load tags", err);
    }
  };

  const handleChange = (field: keyof Document, value: string) => {
    setDocState(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await documentService.update(docState.id, {
        title: docState.title,
        author: docState.author,
        summary: docState.summary,
        keywords: docState.keywords,
        doi: docState.doi,
        isbn: docState.isbn
      });
      onUpdate();
    } catch (err) {
      console.error("Failed to save document details", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete this document? This action cannot be undone.")) {
      try {
        await documentService.delete(document.id, document.file_path);
        onDelete();
      } catch (err) {
        console.error("Failed to delete document", err);
        alert("Failed to delete document. See console for details.");
      }
    }
  };

  return (
    <aside className="inspector-pane transition-all duration-300 flex-shrink-0 w-80 bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col h-full">
      <div className="inspector-header font-semibold py-3 px-4 border-b border-[var(--border-color)] flex justify-between items-center">
        <span>Details</span>
        <button 
          className="btn btn-ghost p-1.5 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded"
          onClick={handleDelete}
          title="Delete Document"
        >
          <Trash2 size={16} />
        </button>
      </div>
      
      <div className="inspector-content p-4 overflow-y-auto flex-1 flex flex-col gap-4 text-sm">
        
        {/* Thumbnail Preview Area */}
        <div className="w-full aspect-4-3 bg-[var(--bg-tertiary)] rounded flex flex-col items-center justify-center border border-dashed border-[var(--border-color)] relative overflow-hidden">
          {docState.thumbnail_path ? (
            <img src={docState.thumbnail_path} alt="Thumbnail" className="object-cover w-full h-full" />
          ) : (
            <>
              <ImageIcon size={32} className="text-muted mb-2 opacity-50" />
              <span className="text-xs text-muted">No Cover</span>
            </>
          )}
          {/* Custom thumbnail upload logic goes here */}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted font-medium uppercase tracking-wider">Title</label>
          <input 
            className="input text-sm" 
            value={docState.title || ""} 
            onChange={e => handleChange("title", e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted font-medium uppercase tracking-wider">Author</label>
          <input 
            className="input text-sm" 
            value={docState.author || ""} 
            onChange={e => handleChange("author", e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted font-medium uppercase tracking-wider">Summary</label>
          <textarea 
            className="input text-sm resize-y" 
            rows={4}
            value={docState.summary || ""} 
            onChange={e => handleChange("summary", e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted font-medium uppercase tracking-wider">Keywords</label>
          <input 
            className="input text-sm" 
            placeholder="comma separated..."
            value={docState.keywords || ""} 
            onChange={e => handleChange("keywords", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted font-medium uppercase tracking-wider">DOI</label>
            <input 
              className="input text-xs py-1 px-2" 
              value={docState.doi || ""} 
              onChange={e => handleChange("doi", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted font-medium uppercase tracking-wider">ISBN</label>
            <input 
              className="input text-xs py-1 px-2" 
              value={docState.isbn || ""} 
              onChange={e => handleChange("isbn", e.target.value)}
            />
          </div>
        </div>
        
        <div className="flex flex-col gap-1 mt-2">
          <label className="text-xs text-muted font-medium uppercase tracking-wider">Tags</label>
          <div className="flex gap-1 flex-wrap mt-1">
            {tags.length === 0 ? <span className="text-xs text-muted italic">No tags assigned</span> : null}
            {tags.map(t => (
              <span key={t.id} className="px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: t.color || 'var(--bg-tertiary)' }}>
                {t.name}
              </span>
            ))}
          </div>
        </div>

        <button 
          className="btn btn-primary mt-4 py-2 w-full flex justify-center items-center gap-2"
          onClick={handleSave}
          disabled={isSaving}
        >
          <Save size={16} />
          {isSaving ? "Saving..." : "Save Details"}
        </button>

      </div>
    </aside>
  );
}
