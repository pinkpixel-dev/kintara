import { useEffect, useState } from "react";
import {
  Download,
  FileText,
  FolderInput,
  Info,
  MoreVertical,
  Star,
  Trash2,
} from "lucide-react";
import { documentUrls, type Document } from "../api";

interface DocumentCardProps {
  document: Document;
  onOpen: () => void;
  onOpenDetails: () => void;
  onToggleFavorite: () => void;
  onMove: () => void;
  onDelete: () => void;
}

/**
 * One document in the library grid, with its actions.
 *
 * The actions used to be four buttons pinned to the four corners of the cover,
 * which left nowhere to put a fifth and covered the part of the art that
 * identifies the document. They now slide up as a bar along the bottom edge:
 * hover on a pointer, a kebab on touch, and keyboard focus on either.
 *
 * Favourite is both a state and an action, so it appears twice on purpose — the
 * corner marker says whether it is favourited without opening anything, and the
 * button in the bar is what changes it.
 */
export function DocumentCard({
  document,
  onOpen,
  onOpenDetails,
  onToggleFavorite,
  onMove,
  onDelete,
}: DocumentCardProps) {
  // Only ever true on touch, where the kebab is the way in. On a pointer the
  // bar is revealed by hover and this stays false.
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMenuOpen]);

  /** Every action sits on top of the card, which is itself a button. */
  const act = (run: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    run();
  };

  return (
    <div
      className="document-card"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // The card is the primary target, so it has to be reachable without a
        // mouse. Guarded on the target so Enter on an action button inside the
        // bar does not also open the document.
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen();
        }
      }}
      draggable={true}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", document.id.toString());
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="document-card-thumb">
        {document.hasThumbnail ? (
          <img
            src={`${documentUrls.thumbnail(document.id)}?v=${document.coverVersion ?? ""}`}
            alt=""
            loading="lazy"
          />
        ) : (
          <FileText size={48} className="text-muted opacity-50" aria-hidden="true" />
        )}

        {/* State, not a control — the control is in the bar, and it is already
            labelled. Announcing this too would just say "favourite" twice. */}
        {document.isFavorite && (
          <span className="document-card-favorite-marker" aria-hidden="true">
            <Star size={14} />
          </span>
        )}

        {/* Hidden on pointer devices, where hover already reveals the bar. */}
        <button
          className="document-card-menu-btn"
          onClick={act(() => setIsMenuOpen((open) => !open))}
          aria-expanded={isMenuOpen}
          aria-label={`Actions for ${document.title}`}
          title="Actions"
        >
          <MoreVertical size={14} />
        </button>

        <div
          className={`document-card-actions ${isMenuOpen ? "is-open" : ""}`}
          role="group"
          aria-label={`Actions for ${document.title}`}
        >
          <button
            className="document-card-action"
            onClick={act(onOpenDetails)}
            title="Show details"
            aria-label={`Show details for ${document.title}`}
          >
            <Info size={14} />
          </button>

          <button
            className={`document-card-action ${document.isFavorite ? "is-favorite" : ""}`}
            onClick={act(onToggleFavorite)}
            title={document.isFavorite ? "Remove from favorites" : "Add to favorites"}
            aria-label={document.isFavorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={document.isFavorite}
          >
            <Star size={14} className={document.isFavorite ? "fill-current" : ""} />
          </button>

          <button
            className="document-card-action"
            onClick={act(onMove)}
            title="Move or add to another library"
            aria-label={`Move or add ${document.title} to another library`}
          >
            <FolderInput size={14} />
          </button>

          {/* An anchor rather than a button so the browser handles the save and
              puts the copy on the device the reader is currently using. */}
          <a
            className="document-card-action"
            href={documentUrls.download(document.id)}
            onClick={(e) => e.stopPropagation()}
            title="Download"
            aria-label={`Download ${document.title}`}
            download
          >
            <Download size={14} />
          </a>

          <button
            className="document-card-action is-danger"
            onClick={act(onDelete)}
            title="Delete document"
            aria-label={`Delete ${document.title}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="document-card-details">
        <h3 className="text-sm font-medium truncate m-0" title={document.title}>
          {document.title}
        </h3>
        <p className="text-xs text-muted truncate mt-1">{document.author || "Unknown Author"}</p>
      </div>
    </div>
  );
}
