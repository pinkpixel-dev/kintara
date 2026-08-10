import { useState } from "react";
import { Download, FileText, Info, Star, Trash2 } from "lucide-react";
import { documentService, documentUrls, type Document } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";

interface DocumentGridProps {
  documents: Document[];
  onOpenDocument: (doc: Document) => void;
  onOpenDetails: (doc: Document) => void;
  onRefresh: () => void;
}

export function DocumentGrid({
  documents,
  onOpenDocument,
  onOpenDetails,
  onRefresh,
}: DocumentGridProps) {
  const [pendingDelete, setPendingDelete] = useState<Document | null>(null);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const doc = pendingDelete;
    setPendingDelete(null);
    try {
      await documentService.remove(doc.id);
      onRefresh();
    } catch (err) {
      console.error("Failed to delete document", err);
    }
  };

  const toggleFavorite = async (doc: Document) => {
    try {
      await documentService.setFavorite(doc.id, !doc.isFavorite);
      onRefresh();
    } catch (err) {
      console.error("Failed to update favorite", err);
    }
  };

  return (
    <div className="document-grid-container">
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
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                // The card is the primary target, so it has to be reachable
                // without a mouse.
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenDocument(doc);
                }
              }}
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", doc.id.toString());
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              <div className="document-card-thumb">
                {doc.hasThumbnail ? (
                  <img src={documentUrls.thumbnail(doc.id)} alt="" loading="lazy" />
                ) : (
                  <FileText size={48} className="text-muted opacity-50" aria-hidden="true" />
                )}

                <button
                  className="document-card-info-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDetails(doc);
                  }}
                  title="View details"
                  aria-label={`View details for ${doc.title}`}
                >
                  <Info size={14} />
                </button>

                <button
                  className={`document-card-star-btn ${doc.isFavorite ? "is-favorite" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(doc);
                  }}
                  title={doc.isFavorite ? "Remove from favorites" : "Add to favorites"}
                  aria-label={doc.isFavorite ? "Remove from favorites" : "Add to favorites"}
                  aria-pressed={doc.isFavorite}
                >
                  <Star size={14} className={doc.isFavorite ? "fill-current" : ""} />
                </button>

                {/* Download is new here: on a NAS the whole point is getting a
                    copy onto the device you are actually reading on. */}
                <a
                  className="document-card-download-btn"
                  href={documentUrls.download(doc.id)}
                  onClick={(e) => e.stopPropagation()}
                  title="Download"
                  aria-label={`Download ${doc.title}`}
                  download
                >
                  <Download size={14} />
                </a>

                <button
                  className="document-card-trash-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete(doc);
                  }}
                  title="Delete document"
                  aria-label={`Delete ${doc.title}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="document-card-details">
                <h3 className="text-sm font-medium truncate m-0" title={doc.title}>
                  {doc.title}
                </h3>
                <p className="text-xs text-muted truncate mt-1">{doc.author || "Unknown Author"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
