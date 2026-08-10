import { useState } from "react";
import type { Document } from "../api";

/**
 * Open reader tabs and the split view that reads from them.
 *
 * Split state lives here rather than alongside it in App because closing a tab
 * has to fix up the split pane's index too — keeping those apart is how the
 * split view ends up pointing at the wrong document.
 */
export function useDocumentTabs() {
  const [openTabs, setOpenTabs] = useState<Document[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [isSplitView, setIsSplitView] = useState(false);
  const [splitRightTabIndex, setSplitRightTabIndex] = useState<number | null>(null);

  const openDocument = (doc: Document) => {
    const existingIndex = openTabs.findIndex((t) => t.id === doc.id);
    if (existingIndex >= 0) {
      setActiveTabIndex(existingIndex);
      return;
    }
    setOpenTabs((prev) => [...prev, doc]);
    setActiveTabIndex(openTabs.length);
  };

  /** Returns true when the last tab closed, so the caller can leave reading mode. */
  const closeTab = (index: number): boolean => {
    const remaining = [...openTabs];
    remaining.splice(index, 1);
    setOpenTabs(remaining);

    if (remaining.length === 0) {
      setIsSplitView(false);
      setSplitRightTabIndex(null);
      return true;
    }

    if (activeTabIndex >= remaining.length) {
      setActiveTabIndex(Math.max(0, remaining.length - 1));
    } else if (activeTabIndex > index) {
      setActiveTabIndex(activeTabIndex - 1);
    }

    // Keep the split pane pointing at the same document it was showing.
    if (isSplitView && splitRightTabIndex === index) {
      setIsSplitView(false);
      setSplitRightTabIndex(null);
    } else if (splitRightTabIndex !== null && splitRightTabIndex > index) {
      setSplitRightTabIndex(splitRightTabIndex - 1);
    }

    return false;
  };

  const closeTabForDocument = (documentId: number): boolean => {
    const index = openTabs.findIndex((t) => t.id === documentId);
    return index === -1 ? false : closeTab(index);
  };

  const toggleSplitView = () => {
    if (isSplitView) {
      setIsSplitView(false);
      setSplitRightTabIndex(null);
    } else {
      setIsSplitView(true);
      setSplitRightTabIndex(activeTabIndex);
    }
  };

  /** Replaces a tab's document in place after its metadata is edited. */
  const replaceDocument = (doc: Document) => {
    setOpenTabs((prev) => prev.map((t) => (t.id === doc.id ? doc : t)));
  };

  const activeDocument = openTabs.length > 0 ? openTabs[activeTabIndex] : null;

  return {
    openTabs,
    activeTabIndex,
    setActiveTabIndex,
    isSplitView,
    splitRightTabIndex,
    setSplitRightTabIndex,
    activeDocument,
    openDocument,
    closeTab,
    closeTabForDocument,
    toggleSplitView,
    replaceDocument,
  };
}
