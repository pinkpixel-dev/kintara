import { Columns, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { TabBar } from "./TabBar";
import { DocumentActions } from "./DocumentActions";
import type { Document } from "../api";

interface AppHeaderProps {
  tabs: Document[];
  activeTabIndex: number;
  activeDocument: Document | null;
  isReading: boolean;
  isSplitView: boolean;
  splitRightTabIndex: number | null;
  isLeftSidebarOpen: boolean;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  onSetSplitRightTab: (index: number) => void;
  onToggleSplitView: () => void;
  onToggleLeftSidebar: () => void;
  onOpenDetails: (doc: Document) => void;
  onToggleFavorite: (doc: Document) => void;
  onMove: (doc: Document) => void;
  onDelete: (doc: Document) => void;
}

/**
 * The bar above the library and the reader: the sidebar toggle, the tab strip,
 * and the actions for whatever is currently open.
 *
 * There is no Details toggle here any more. Details is a thing you ask for
 * about a specific document, so it opens from that document's own actions and
 * closes from its own header — a toggle that opened an empty panel with
 * "select a document" in it was a control that could do nothing most of the
 * time. The slot it used to occupy is deliberately left free.
 */
export function AppHeader({
  tabs,
  activeTabIndex,
  activeDocument,
  isReading,
  isSplitView,
  splitRightTabIndex,
  isLeftSidebarOpen,
  onSelectTab,
  onCloseTab,
  onSetSplitRightTab,
  onToggleSplitView,
  onToggleLeftSidebar,
  onOpenDetails,
  onToggleFavorite,
  onMove,
  onDelete,
}: AppHeaderProps) {
  return (
    <div className="h-12 border-b border-[var(--border-color)] bg-[var(--bg-primary)] flex items-center px-2 z-10 flex-shrink-0">
      <button
        className="btn btn-ghost p-1.5 text-muted hover:text-primary mr-2 flex-shrink-0 rounded"
        onClick={onToggleLeftSidebar}
        title={isLeftSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
      >
        {isLeftSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
      </button>

      <TabBar
        tabs={tabs}
        activeIndex={activeTabIndex}
        isReading={isReading}
        onSelect={onSelectTab}
        onClose={onCloseTab}
      />

      <div className="flex items-center gap-2 flex-shrink-0 ml-auto pr-2">
        {isReading && activeDocument && (
          <DocumentActions
            document={activeDocument}
            onOpenDetails={() => onOpenDetails(activeDocument)}
            onToggleFavorite={() => onToggleFavorite(activeDocument)}
            onMove={() => onMove(activeDocument)}
            onDelete={() => onDelete(activeDocument)}
          />
        )}

        {isReading && isSplitView && splitRightTabIndex !== null && (
          <select
            className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-primary rounded px-2 py-1 text-xs mr-2 cursor-pointer focus:outline-none focus:border-[var(--accent)] transition-all"
            value={splitRightTabIndex}
            onChange={(e) => onSetSplitRightTab(Number(e.target.value))}
            title="Split View Document"
          >
            {tabs.map((t, idx) => (
              <option key={idx} value={idx}>{t.title}</option>
            ))}
          </select>
        )}

        {isReading && (
          <button
            className={`btn btn-ghost p-1.5 rounded ${isSplitView ? 'text-[var(--accent)] bg-[var(--accent)]/10' : 'text-muted hover:text-primary hover:bg-[var(--bg-tertiary)]'}`}
            onClick={onToggleSplitView}
            title="Toggle Split View"
            disabled={tabs.length === 0}
          >
            <Columns size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
