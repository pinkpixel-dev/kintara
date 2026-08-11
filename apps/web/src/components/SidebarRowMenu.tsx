import { useEffect, useRef } from "react";
import { FilePlus, FolderPlus } from "lucide-react";

/**
 * An open row menu, positioned against the button that opened it.
 *
 * `right` is the gap from the viewport's right edge, not a left offset. These
 * buttons sit at the right of their row, so a menu anchored by its left edge
 * runs off a phone screen — anchoring the right edge instead makes it open
 * leftwards under the button and stay on screen without measuring it first.
 */
export interface RowMenuState {
  libraryId: number;
  name: string;
  right: number;
  y: number;
}

interface SidebarRowMenuProps {
  menu: RowMenuState;
  onClose: () => void;
  onImportHere: () => void;
  onNewCollection: () => void;
}

/**
 * The add menu on a library row.
 *
 * Positioned `fixed` from the button's rect rather than absolutely inside the
 * row, because the sidebar scrolls — an absolutely positioned menu would be
 * clipped by `overflow-y: auto` the moment it extended past its row.
 */
export function SidebarRowMenu({ menu, onClose, onImportHere, onNewCollection }: SidebarRowMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    // Focus moves into the menu so it is usable without a mouse.
    ref.current?.querySelector('button')?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      {/* Catches the click that dismisses the menu, including a tap on a phone
          where there is no such thing as clicking away harmlessly. */}
      <div className="row-menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className="row-menu"
        style={{ top: menu.y, right: menu.right }}
        role="menu"
        aria-label={`Add to ${menu.name}`}
      >
        <button type="button" role="menuitem" className="row-menu-item" onClick={onImportHere}>
          <FilePlus size={14} aria-hidden="true" />
          Import a document here
        </button>
        <button type="button" role="menuitem" className="row-menu-item" onClick={onNewCollection}>
          <FolderPlus size={14} aria-hidden="true" />
          New collection
        </button>
      </div>
    </>
  );
}
