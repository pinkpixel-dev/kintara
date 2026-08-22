import { useState } from "react";
import { documentService, type Document } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { DocumentCard } from "./DocumentCard";
import { EmptyState, type EmptyReason } from "./EmptyState";

interface DocumentGridProps {
  documents: Document[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadError: string | null;
  /** Why the grid is empty, when it is. Never read while there are documents. */
  emptyReason: EmptyReason;
  onOpenDocument: (doc: Document) => void;
  onOpenDetails: (doc: Document) => void;
  onMove: (doc: Document) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onSearchEverywhere: () => void;
  onImport: () => void;
}

export function DocumentGrid({
  documents,
  total,
  hasMore,
  isLoading,
  isLoadingMore,
  loadError,
  emptyReason,
  onOpenDocument,
  onOpenDetails,
  onMove,
  onRefresh,
  onLoadMore,
  onRetry,
  onSearchEverywhere,
  onImport,
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

      {isLoading && documents.length === 0 ? (
        <div className="document-grid-status" role="status">Loading documents...</div>
      ) : loadError && documents.length === 0 ? (
        <div className="document-grid-status" role="alert">
          <p>{loadError}</p>
          <button type="button" className="btn btn-primary" onClick={onRetry}>Try again</button>
        </div>
      ) : documents.length === 0 ? (
        <EmptyState
          reason={emptyReason}
          onSearchEverywhere={onSearchEverywhere}
          onImport={onImport}
        />
      ) : (
        <>
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
          <div className="document-grid-pagination">
            <p className="document-grid-count" aria-live="polite">
              Showing {documents.length} of {total} {total === 1 ? "document" : "documents"}
            </p>
            {loadError && <p className="document-grid-load-error" role="alert">{loadError}</p>}
            {hasMore && (
              <button
                type="button"
                className="btn btn-ghost document-grid-load-more"
                onClick={loadError ? onRetry : onLoadMore}
                disabled={isLoadingMore}
                aria-busy={isLoadingMore}
              >
                {isLoadingMore ? "Loading..." : loadError ? "Try again" : "Load more"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
