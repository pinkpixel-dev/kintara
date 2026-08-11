import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  collectionService,
  libraryService,
  type Collection,
  type Document,
  type Library,
} from "../api";

/** Where the document is being viewed from, if anywhere in particular. */
export interface DocumentScope {
  type: 'library' | 'collection';
  id: number;
}

interface MoveDocumentModalProps {
  document: Document;
  /** Present only when the document was opened from inside a library or
   *  collection. Without one there is nothing to move it out of. */
  scope?: DocumentScope;
  onClose: () => void;
  onMoved: () => void;
}

/**
 * Files a document into another library or collection.
 *
 * Offers two separate actions rather than one, because libraries here are views
 * over the documents rather than folders that own them — a document can sit in
 * several at once, and that is a normal thing to want. "Move" takes it out of
 * where you are looking and puts it in the destination; "Add" leaves it where it
 * is. Move is only offered when there is a scope to remove it from, so it never
 * silently does nothing from All Documents.
 */
export function MoveDocumentModal({ document, scope, onClose, onMoved }: MoveDocumentModalProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [collections, setCollections] = useState<Record<number, Collection[]>>({});
  const [libraryId, setLibraryId] = useState<number | "">("");
  const [collectionId, setCollectionId] = useState<number | "">("");
  const [busy, setBusy] = useState<"move" | "add" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [libs, allCollections] = await Promise.all([
          libraryService.list(),
          collectionService.list(),
        ]);
        setLibraries(libs);

        const grouped: Record<number, Collection[]> = {};
        for (const collection of allCollections) {
          (grouped[collection.libraryId] ??= []).push(collection);
        }
        setCollections(grouped);

        // Default to somewhere other than where it already is, so the dialog
        // opens on a destination that would actually change something.
        const elsewhere = libs.find((l) => !(scope?.type === 'library' && l.id === scope.id));
        if (elsewhere) setLibraryId(elsewhere.id);
      } catch (err) {
        console.error("Failed to load destinations", err);
        setError("Could not load libraries.");
      }
    };
    load();
  }, [scope]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const destinationName = (() => {
    if (collectionId !== "") {
      const found = Object.values(collections).flat().find((c) => c.id === collectionId);
      if (found) return found.name;
    }
    return libraries.find((l) => l.id === libraryId)?.name ?? "";
  })();

  // Resolved from the lists already loaded here rather than passed in, so the
  // caller only has to know which view the document came from.
  const scopeName = (() => {
    if (!scope) return null;
    if (scope.type === 'library') return libraries.find((l) => l.id === scope.id)?.name ?? null;
    return Object.values(collections).flat().find((c) => c.id === scope.id)?.name ?? null;
  })();

  const submit = async (mode: "move" | "add") => {
    if (libraryId === "") return;
    setBusy(mode);
    setError(null);

    try {
      // Added before removed. If the add fails the document is still where it
      // was, which is the recoverable order to fail in.
      await libraryService.addDocument(Number(libraryId), document.id);
      if (collectionId !== "") {
        await collectionService.addDocument(Number(collectionId), document.id);
      }

      if (mode === "move" && scope) {
        if (scope.type === 'library') {
          await libraryService.removeDocument(scope.id, document.id);
        } else {
          await collectionService.removeDocument(scope.id, document.id);
        }
      }

      onMoved();
    } catch (err) {
      console.error("Failed to file document", err);
      setError(err instanceof Error ? err.message : "Could not file the document.");
      setBusy(null);
    }
  };

  const availableCollections = libraryId === "" ? [] : collections[libraryId] ?? [];

  return (
    <div className="fixed-overlay z-100 animate-in fade-in duration-200" role="dialog" aria-modal="true">
      <div className="modal-content" style={{ maxWidth: "440px" }}>
        <div className="modal-header">
          <h2 className="font-semibold text-base m-0">File "{document.title}"</h2>
          <button
            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-muted transition-colors border-none bg-transparent cursor-pointer"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted font-medium uppercase tracking-wider" htmlFor="move-library">
              Library
            </label>
            <select
              id="move-library"
              className="input cursor-pointer"
              value={libraryId}
              onChange={(e) => {
                setLibraryId(e.target.value === "" ? "" : Number(e.target.value));
                setCollectionId("");
              }}
            >
              <option value="">-- Choose a library --</option>
              {libraries.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          {availableCollections.length > 0 && (
            <div className="flex flex-col gap-1">
              <label
                className="text-xs text-muted font-medium uppercase tracking-wider"
                htmlFor="move-collection"
              >
                Collection (Optional)
              </label>
              <select
                id="move-collection"
                className="input cursor-pointer"
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">-- No collection --</option>
                {availableCollections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          <p className="text-xs text-muted m-0">
            {scopeName
              ? `Move takes it out of ${scopeName}. Add leaves it there as well.`
              : "A document can belong to more than one library."}
          </p>

          <div className="import-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy !== null}>
              Cancel
            </button>
            <button
              className={scope ? "btn btn-ghost" : "btn btn-primary"}
              onClick={() => submit("add")}
              disabled={libraryId === "" || busy !== null}
            >
              {busy === "add" ? "Adding..." : destinationName ? `Add to ${destinationName}` : "Add"}
            </button>
            {scope && (
              <button
                className="btn btn-primary"
                onClick={() => submit("move")}
                disabled={libraryId === "" || busy !== null}
              >
                {busy === "move" ? "Moving..." : "Move here"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
