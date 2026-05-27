import { FileText, Info } from "lucide-react";
import { Document } from "../db";

interface DocumentGridProps {
  documents: Document[];
  onOpenDocument: (doc: Document) => void;
  onOpenDetails: (doc: Document) => void;
}

export function DocumentGrid({ documents, onOpenDocument, onOpenDetails }: DocumentGridProps) {
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
              className="document-card"
              onClick={() => onOpenDocument(doc)}
            >
              <div className="document-card-thumb">
                {doc.thumbnail_path ? (
                  <img src={doc.thumbnail_path} alt={doc.title} />
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
