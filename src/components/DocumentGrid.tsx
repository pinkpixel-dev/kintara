import { FileText, Info, Star, Trash2 } from "lucide-react";
import { Document, documentService } from "../db";
import { convertFileSrc } from "@tauri-apps/api/core";

interface DocumentGridProps {
  documents: Document[];
  onOpenDocument: (doc: Document) => void;
  onOpenDetails: (doc: Document) => void;
  onRefresh: () => void;
}

export function DocumentGrid({ documents, onOpenDocument, onOpenDetails, onRefresh }: DocumentGridProps) {
  return (
    <div className="document-grid-container">
      {documents.length === 0 ? (
        <div className="text-center text-muted mt-10">
          <p>No documents found in this view.</p>
        </div>
      ) : (
        <div className="document-grid">
          {documents.map((doc) => (
            <div 
              key={doc.id} 
              className="document-card group"
              onClick={() => onOpenDocument(doc)}
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', doc.id.toString());
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              <div className="document-card-thumb">
                {doc.thumbnail_path ? (
                  <img src={convertFileSrc(doc.thumbnail_path)} alt={doc.title} />
                ) : (
                  <FileText size={48} className="text-muted opacity-50" />
                )}
                {/* Details Button Overlay */}
                <button 
                  className="document-card-info-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDetails(doc);
                  }}
                  title="View Details"
                >
                  <Info size={14} />
                </button>
                {/* Favorite Button Overlay */}
                <button 
                  className={`document-card-star-btn ${doc.is_favorite === 1 ? 'is-favorite' : ''}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await documentService.toggleFavorite(doc.id, doc.is_favorite);
                    onRefresh();
                  }}
                  title={doc.is_favorite === 1 ? "Remove from Favorites" : "Add to Favorites"}
                >
                  <Star size={14} className={doc.is_favorite === 1 ? 'fill-current' : ''} />
                </button>
                {/* Trash Button Overlay */}
                <button 
                  className="document-card-trash-btn"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (window.confirm("Are you sure you want to delete this document?")) {
                      await documentService.delete(doc.id, doc.file_path);
                      onRefresh();
                    }
                  }}
                  title="Delete Document"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="document-card-details">
                <h3 className="text-sm font-medium truncate m-0" title={doc.title}>{doc.title}</h3>
                <p className="text-xs text-muted truncate mt-1">{doc.author || 'Unknown Author'}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
