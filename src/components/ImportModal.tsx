import { useState, useEffect } from "react";
import { X, Image as ImageIcon } from "lucide-react";
import { Document, Library, Collection, libraryService, collectionService, documentService } from "../db";
import { convertFileSrc } from "@tauri-apps/api/core";

interface ImportModalProps {
  document: Document;
  onClose: () => void;
  onComplete: () => void;
}

export function ImportModal({ document, onClose, onComplete }: ImportModalProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [collections, setCollections] = useState<Record<number, Collection[]>>({});
  const [selectedLibraryId, setSelectedLibraryId] = useState<number | "">("");
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | "">("");
  
  const [docState, setDocState] = useState<Document>(document);

  useEffect(() => {
    const loadDb = async () => {
      const libs = await libraryService.getAll();
      setLibraries(libs);
      
      const cols: Record<number, Collection[]> = {};
      for (const l of libs) {
        cols[l.id] = await collectionService.getAllForLibrary(l.id);
      }
      setCollections(cols);
      
      if (libs.length > 0) {
        setSelectedLibraryId(libs[0].id);
      }
    };
    loadDb();
  }, []);

  const handleSave = async () => {
    // Save metadata
    await documentService.update(document.id, {
      title: docState.title,
    });
    
    // Save placement
    if (selectedLibraryId) {
      await libraryService.addDocument(Number(selectedLibraryId), document.id);
    }
    if (selectedCollectionId) {
      await collectionService.addDocument(Number(selectedCollectionId), document.id);
    }
    
    onComplete();
  };

  const handleCancel = async () => {
    if (window.confirm("Are you sure you want to cancel importing this document?")) {
      await documentService.delete(document.id, document.file_path);
      onClose();
    }
  };

  return (
    <div className="fixed-overlay z-100 animate-in fade-in duration-200">
      <div className="modal-content large" style={{ maxWidth: '600px' }}>
        <div className="modal-header">
          <h2 className="font-semibold text-lg m-0">Import Document</h2>
          <button className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-muted transition-colors border-none bg-transparent cursor-pointer" onClick={handleCancel}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body flex-row gap-6">
          <div className="w-1/3 aspect-4-3 bg-[var(--bg-tertiary)] rounded flex flex-col items-center justify-center border border-dashed border-[var(--border-color)] relative overflow-hidden flex-shrink-0">
            {docState.thumbnail_path ? (
              <img src={convertFileSrc(docState.thumbnail_path)} alt="Thumbnail" className="object-cover w-full h-full" />
            ) : (
              <>
                <ImageIcon size={32} className="text-muted mb-2 opacity-50" />
                <span className="text-xs text-muted">No Cover</span>
              </>
            )}
          </div>
          
          <div className="flex-1 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted font-medium uppercase tracking-wider">Title</label>
              <input className="input" value={docState.title} onChange={e => setDocState({...docState, title: e.target.value})} autoFocus />
            </div>
            
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted font-medium uppercase tracking-wider">Library</label>
              <select className="input cursor-pointer" value={selectedLibraryId} onChange={e => {
                setSelectedLibraryId(Number(e.target.value));
                setSelectedCollectionId("");
              }}>
                <option value="">-- Don't add to library yet --</option>
                {libraries.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            
            {selectedLibraryId !== "" && collections[selectedLibraryId as number]?.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted font-medium uppercase tracking-wider">Collection (Optional)</label>
                <select className="input cursor-pointer" value={selectedCollectionId} onChange={e => setSelectedCollectionId(Number(e.target.value))}>
                  <option value="">-- No collection --</option>
                  {collections[selectedLibraryId as number].map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            
            <div className="flex justify-end gap-3 mt-auto pt-4">
              <button className="btn btn-ghost text-red-400 hover:text-red-500 hover:bg-red-500/10" onClick={handleCancel}>Cancel Import</button>
              <button className="btn btn-primary" onClick={handleSave}>Save Document</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
