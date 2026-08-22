import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { Document } from "../api";

interface Options {
  openTabs: Document[];
  activeTabIndex: number;
  viewMode: 'grid' | 'reading';
  closeTab: (index: number) => boolean;
  setViewMode: (mode: 'grid' | 'reading') => void;
  setIsLeftSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setIsSettingsOpen: (open: boolean) => void;
  setIsHelpOpen: (open: boolean) => void;
  startImport: () => void;
}

/**
 * The application-wide keyboard shortcuts.
 *
 * Lifted out of `App` unchanged when that file reached its size limit. The
 * dependency list is deliberately the same one it had there: the handler closes
 * over the open tabs and the current mode, so it has to be rebound when either
 * changes.
 */
export function useKeyboardShortcuts({
  openTabs,
  activeTabIndex,
  viewMode,
  closeTab,
  setViewMode,
  setIsLeftSidebarOpen,
  setIsSettingsOpen,
  setIsHelpOpen,
  startImport,
}: Options) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'i':
            e.preventDefault();
            startImport();
            break;
          case 'f':
            // focus search logic
            e.preventDefault();
            const searchInput = document.querySelector('.sidebar-content input[type="text"]') as HTMLInputElement;
            if (searchInput) {
              setIsLeftSidebarOpen(true);
              setTimeout(() => searchInput.focus(), 100);
            }
            break;
          case ',':
            e.preventDefault();
            setIsSettingsOpen(true);
            break;
          case 'w':
            e.preventDefault();
            if (viewMode === 'reading' && openTabs.length > 0) {
              if (closeTab(activeTabIndex)) setViewMode('grid');
            }
            break;
          case 'b':
            e.preventDefault();
            setIsLeftSidebarOpen(prev => !prev);
            break;
        }
      } else if (e.key === 'F1') {
        e.preventDefault();
        setIsHelpOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openTabs, activeTabIndex, viewMode]);
}
