import { useState } from "react";
import { documentService, type Document } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { DocumentCard } from "./DocumentCard";

interface DocumentGridProps {
  documents: Document[];
  onOpenDocument: (doc: Document) => void;
  onOpenDetails: (doc: Document) => void;
  onMove: (doc: Document) => void;
  onRefresh: () => void;
}

export function DocumentGrid({
  documents,
  onOpenDocument,
  onOpenDetails,
  onMove,
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
            <DocumentCard
              key={doc.id}
              document={doc}
              onOpen={() => onOpenDocument(doc)}
              onOpenDetails={() => onOpenDetails(doc)}
              onToggleFavorite={() => toggleFavorite(doc)}
              onMove={() => onMove(doc)}
              onDelete={() => setPendingDelete(doc)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
