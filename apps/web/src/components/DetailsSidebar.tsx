import { useState, useEffect } from "react";
import { useRef } from "react";
import { documentService, documentUrls, tagService, type Document, type Tag } from "../api";
import { Save, Image as ImageIcon, X } from "lucide-react";

interface DetailsSidebarProps {
  document: Document;
  onUpdate: () => void;
  onDelete: () => void;
}

export function DetailsSidebar({ document, onUpdate }: DetailsSidebarProps) {
  const [docState, setDocState] = useState<Document>(document);
  const [isSaving, setIsSaving] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [coverVersion, setCoverVersion] = useState(0);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDocState(document);
    loadTags(document.id);
  }, [document]);

  const loadTags = async (docId: number) => {
    try {
      setTags(await documentService.tags(docId));
    } catch (err) {
      console.error("Failed to load tags", err);
    }
  };

  const handleChange = (field: keyof Document, value: string) => {
    setDocState(prev => ({ ...prev, [field]: value }));
  };

  const handleCoverSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file twice still fires a change event.
    event.target.value = "";
    if (!file) return;

    try {
      await documentService.uploadCover(document.id, file);
      setDocState(prev => ({ ...prev, hasThumbnail: true }));
      // The thumbnail URL is stable but its contents changed, and the response
      // is cached hard, so a cache-busting parameter is needed to see the new one.
      setCoverVersion(v => v + 1);
      onUpdate();
    } catch (err) {
      console.error("Failed to update cover", err);
    }
  };

  const handleAddTag = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newTagInput.trim()) {
      e.preventDefault();
      const tagName = newTagInput.trim();
      setNewTagInput("");
      
      try {
        const colors = ['rgba(248, 113, 113, 0.2)', 'rgba(251, 146, 60, 0.2)', 'rgba(251, 191, 36, 0.2)', 'rgba(163, 230, 53, 0.2)', 'rgba(74, 222, 128, 0.2)', 'rgba(45, 212, 191, 0.2)', 'rgba(56, 189, 248, 0.2)', 'rgba(129, 140, 248, 0.2)', 'rgba(167, 139, 250, 0.2)', 'rgba(232, 121, 249, 0.2)'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        // The server returns the existing tag when the name is taken, so there
        // is no need to fetch every tag first just to look for a match.
        const tag = await tagService.create(tagName, randomColor);
        await documentService.addTag(document.id, tag.id);
        await loadTags(document.id);
      } catch (err) {
        console.error("Failed to add tag", err);
      }
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    try {
      await documentService.removeTag(document.id, tagId);
      await loadTags(document.id);
    } catch (err) {
      console.error("Failed to remove tag", err);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const orNull = (value: string | null) => {
        const trimmed = (value ?? "").trim();
        return trimmed === "" ? null : trimmed;
      };

      await documentService.update(docState.id, {
        title: docState.title.trim(),
        author: orNull(docState.author),
        summary: orNull(docState.summary),
        keywords: orNull(docState.keywords),
        doi: orNull(docState.doi),
        isbn: orNull(docState.isbn),
      });
      onUpdate();
    } catch (err) {
      console.error("Failed to save document details", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <aside className="inspector-pane transition-all duration-300 flex-shrink-0 w-80 bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col h-full">
      <div className="inspector-header font-semibold py-3 px-4 border-b border-[var(--border-color)] flex justify-between items-center">
        <span>Details</span>
      </div>
      
      <div className="inspector-content p-4 overflow-y-auto flex-1 flex flex-col gap-4 text-sm">
        
        {/* Thumbnail Preview Area */}
        <input
          ref={coverInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleCoverSelected}
        />
        <button
          type="button"
          className="w-full aspect-3-4 bg-[var(--bg-tertiary)] rounded flex flex-col items-center justify-center border border-dashed border-[var(--border-color)] relative overflow-hidden cursor-pointer hover:border-[var(--accent)] transition-colors group p-0"
          onClick={() => coverInputRef.current?.click()}
          title="Change cover image"
          aria-label="Change cover image"
        >
          {docState.hasThumbnail ? (
            <img
              src={`${documentUrls.thumbnail(docState.id)}?v=${coverVersion}`}
              alt=""
              className="object-cover w-full h-full"
            />
          ) : (
            <>
              <ImageIcon size={32} className="text-muted mb-2 opacity-50 group-hover:text-[var(--accent)] transition-colors" />
              <span className="text-xs text-muted group-hover:text-primary transition-colors">Click to upload cover</span>
            </>
          )}
        </button>

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
              <span key={t.id} className="px-2 py-0.5 rounded-full text-xs flex items-center gap-1 border" style={{ backgroundColor: t.color || 'var(--bg-tertiary)', borderColor: t.color ? t.color.replace('0.2)', '0.5)') : 'var(--border-color)' }}>
                {t.name}
                <button 
                  className="bg-transparent border-none text-muted hover:text-red-500 cursor-pointer p-0 flex items-center"
                  onClick={() => handleRemoveTag(t.id)}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <input 
            className="input text-xs mt-2 py-1.5" 
            placeholder="Type tag and press Enter..."
            value={newTagInput}
            onChange={e => setNewTagInput(e.target.value)}
            onKeyDown={handleAddTag}
          />
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
