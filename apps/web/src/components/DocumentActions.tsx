import { Download, FolderInput, Info, Star, Trash2 } from "lucide-react";
import { documentUrls, type Document } from "../api";

interface DocumentActionsProps {
  document: Document;
  onOpenDetails: () => void;
  onToggleFavorite: () => void;
  onMove: () => void;
  onDelete: () => void;
}

/**
 * The per-document actions, for the reader's header.
 *
 * These already existed on the library cards and stopped at the reader door, so
 * favouriting something you were actually reading meant going back to the grid
 * to find its card. Same set, same order, so the two surfaces agree.
 */
export function DocumentActions({
  document,
  onOpenDetails,
  onToggleFavorite,
  onMove,
  onDelete,
}: DocumentActionsProps) {
  return (
    <div className="reader-actions" role="group" aria-label={`Actions for ${document.title}`}>
      <button
        className="reader-action"
        onClick={onOpenDetails}
        title="View details"
        aria-label={`View details for ${document.title}`}
      >
        <Info size={18} />
      </button>

      <button
        className={`reader-action ${document.isFavorite ? "is-favorite" : ""}`}
        onClick={onToggleFavorite}
        title={document.isFavorite ? "Remove from favorites" : "Add to favorites"}
        aria-label={document.isFavorite ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={document.isFavorite}
      >
        <Star size={18} className={document.isFavorite ? "fill-current" : ""} />
      </button>

      <button
        className="reader-action"
        onClick={onMove}
        title="Move or add to another library"
        aria-label={`Move or add ${document.title} to another library`}
      >
        <FolderInput size={18} />
      </button>

      {/* An anchor rather than a button so the browser handles the save itself,
          the same way the card's download does. */}
      <a
        className="reader-action"
        href={documentUrls.download(document.id)}
        title="Download"
        aria-label={`Download ${document.title}`}
        download
      >
        <Download size={18} />
      </a>

      <button
        className="reader-action is-danger"
        onClick={onDelete}
        title="Delete document"
        aria-label={`Delete ${document.title}`}
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
}
