import { useState } from "react";
import { collectionService, libraryService, type Collection, type Library } from "../api";

/**
 * State for the library and collection settings dialog.
 *
 * Driven by the gear on each sidebar row rather than by the active view, so a
 * library can be renamed without first navigating into it. That means the
 * entity has to be fetched on open rather than read from what is on screen.
 */
export function useEntitySettings() {
  const [isOpen, setIsOpen] = useState(false);
  const [library, setLibrary] = useState<Library | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [mode, setMode] = useState<'library' | 'collection'>('library');

  /**
   * Errors are caught because an unhandled rejection in a click handler fails
   * silently, which reads as a button that does nothing.
   */
  const open = async (type: 'library' | 'collection', id: number) => {
    try {
      if (type === 'library') {
        const libs = await libraryService.list();
        const found = libs.find((l) => l.id === id) ?? null;
        if (!found) return;
        setLibrary(found);
        setCollection(null);
        setMode('library');
      } else {
        const found = await collectionService.get(id);
        if (!found) return;
        setCollection(found);
        setLibrary(null);
        setMode('collection');
      }
      setIsOpen(true);
    } catch (err) {
      console.error("Failed to open settings", err);
    }
  };

  return { isOpen, library, collection, mode, open, close: () => setIsOpen(false) };
}
