import { useEffect, useRef, useState } from "react";
import { Download, FolderInput, Info, MoreVertical, Star, Trash2 } from "lucide-react";
import { documentUrls, type Document } from "../api";

interface DocumentActionsProps {
  document: Document;
  onOpenDetails: () => void;
  onToggleFavorite: () => void;
  onMove: () => void;
  onDelete: () => void;
}

/** Where the overflow menu opens, measured from the button that opened it. */
interface MenuPosition {
  right: number;
  y: number;
}

/**
 * The per-document actions, for the reader's header.
 *
 * These mirror the card's action bar so the two surfaces agree on what you can
 * do to a document and in what order.
 *
 * Below 640px the row is hidden — the tab strip needs the room — and collapses
 * into a single overflow menu instead of disappearing. It used to disappear,
 * which was survivable only while the header still carried a Details toggle;
 * with that gone, hiding the row would leave a phone with no way to reach a
 * document's details from the reader at all.
 */
export function DocumentActions({
  document,
  onOpenDetails,
  onToggleFavorite,
  onMove,
  onDelete,
}: DocumentActionsProps) {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    // Focus moves into the menu so it is usable without a mouse.
    menuRef.current?.querySelector("button")?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu]);

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Anchored by its right edge, like the sidebar row menus: the button sits
    // at the right of the header, so a menu anchored left runs off a phone.
    setMenu({ right: window.innerWidth - rect.right, y: rect.bottom + 4 });
  };

  const pick = (run: () => void) => () => {
    setMenu(null);
    run();
  };

  const favoriteLabel = document.isFavorite ? "Remove from favorites" : "Add to favorites";

  return (
    <>
      <div className="reader-actions" role="group" aria-label={`Actions for ${document.title}`}>
        <button
          className="reader-action"
          onClick={onOpenDetails}
          title="Show details"
          aria-label={`Show details for ${document.title}`}
        >
          <Info size={18} />
        </button>

        <button
          className={`reader-action ${document.isFavorite ? "is-favorite" : ""}`}
          onClick={onToggleFavorite}
          title={favoriteLabel}
          aria-label={favoriteLabel}
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

        {/* An anchor rather than a button so the browser handles the save
            itself, the same way the card's download does. */}
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

      {/* The same five actions, for the widths where the row does not fit. */}
      <button
        className="reader-menu-btn"
        onClick={openMenu}
        aria-expanded={menu !== null}
        aria-label={`Actions for ${document.title}`}
        title="Actions"
      >
        <MoreVertical size={18} />
      </button>

      {menu && (
        <>
          <div className="row-menu-backdrop" onClick={() => setMenu(null)} aria-hidden="true" />
          <div
            ref={menuRef}
            className="row-menu"
            style={{ top: menu.y, right: menu.right }}
            role="menu"
            aria-label={`Actions for ${document.title}`}
          >
            <button type="button" role="menuitem" className="row-menu-item" onClick={pick(onOpenDetails)}>
              <Info size={14} aria-hidden="true" />
              Show details
            </button>
            <button type="button" role="menuitem" className="row-menu-item" onClick={pick(onToggleFavorite)}>
              <Star size={14} aria-hidden="true" className={document.isFavorite ? "fill-current" : ""} />
              {favoriteLabel}
            </button>
            <button type="button" role="menuitem" className="row-menu-item" onClick={pick(onMove)}>
              <FolderInput size={14} aria-hidden="true" />
              Move or add to another library
            </button>
            <a
              role="menuitem"
              className="row-menu-item"
              href={documentUrls.download(document.id)}
              onClick={() => setMenu(null)}
              download
            >
              <Download size={14} aria-hidden="true" />
              Download
            </a>
            <button
              type="button"
              role="menuitem"
              className="row-menu-item is-danger"
              onClick={pick(onDelete)}
            >
              <Trash2 size={14} aria-hidden="true" />
              Delete document
            </button>
          </div>
        </>
      )}
    </>
  );
}
