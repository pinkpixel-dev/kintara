import { useState, useEffect } from "react";
import { X, Image as ImageIcon } from "lucide-react";
import {
  collectionService,
  documentService,
  documentUrls,
  libraryService,
  type Collection,
  type Document,
  type Library,
} from "../api";
import { ConfirmDialog } from "./ConfirmDialog";

interface ImportModalProps {
  document: Document;
  /** Preselected when the import was started from a library or collection row. */
  defaultLibraryId?: number;
  defaultCollectionId?: number;
  onClose: () => void;
  onComplete: () => void;
}

/** Sentinel for the "create one" entry in the library picker. */
const NEW_LIBRARY = "new";

/**
 * Shown after a file has been uploaded, to name it and file it away.
 *
 * The upload has already happened by this point — the server needed the bytes
 * to extract metadata and render a cover — so cancelling here deletes the
 * document rather than simply closing.
 */
export function ImportModal({
  document,
  defaultLibraryId,
  defaultCollectionId,
  onClose,
  onComplete,
}: ImportModalProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [collections, setCollections] = useState<Record<number, Collection[]>>({});
  const [selectedLibraryId, setSelectedLibraryId] = useState<number | "" | typeof NEW_LIBRARY>("");
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | "">(
    defaultCollectionId ?? "",
  );
  const [newLibraryName, setNewLibraryName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const [docState, setDocState] = useState<Document>(document);

  useEffect(() => {
    const load = async () => {
      try {
        const libs = await libraryService.list();
        setLibraries(libs);

        // One request for every collection, then grouped, rather than a request
        // per library.
        const all = await collectionService.list();
        const grouped: Record<number, Collection[]> = {};
        for (const collection of all) {
          (grouped[collection.libraryId] ??= []).push(collection);
        }
        setCollections(grouped);

        // Importing from a library or collection row means the destination is
        // already decided; otherwise fall back to the first library.
        if (defaultLibraryId && libs.some((l) => l.id === defaultLibraryId)) {
          setSelectedLibraryId(defaultLibraryId);
        } else if (libs.length > 0) {
          setSelectedLibraryId(libs[0].id);
        }
      } catch (err) {
        console.error("Failed to load libraries", err);
      }
    };
    load();
  }, [defaultLibraryId]);

  const isCreatingLibrary = selectedLibraryId === NEW_LIBRARY;

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      if (docState.title.trim() && docState.title !== document.title) {
        await documentService.update(document.id, { title: docState.title.trim() });
      }

      // A new library is created first so the document has somewhere to go. If
      // this throws, the import is still recoverable — the document exists and
      // the modal stays open with the error.
      let libraryId = selectedLibraryId;
      if (isCreatingLibrary) {
        const created = await libraryService.create({ name: newLibraryName.trim() });
        libraryId = created.id;
      }

      if (libraryId !== "" && libraryId !== NEW_LIBRARY) {
        await libraryService.addDocument(Number(libraryId), document.id);
      }
      if (selectedCollectionId !== "") {
        await collectionService.addDocument(Number(selectedCollectionId), document.id);
      }
      onComplete();
    } catch (err) {
      console.error("Failed to save document", err);
      setSaveError(err instanceof Error ? err.message : "Could not save. Please try again.");
      setIsSaving(false);
    }
  };

  const handleCancelConfirmed = async () => {
    setConfirmCancel(false);
    try {
      await documentService.remove(document.id);
    } catch (err) {
      console.error("Failed to discard import", err);
    }
    onClose();
  };

  return (
    <div className="fixed-overlay z-100 animate-in fade-in duration-200">
      <ConfirmDialog
        isOpen={confirmCancel}
        title="Discard import"
        message="This document and its file will be removed from the library."
        confirmLabel="Discard"
        cancelLabel="Keep importing"
        danger
        onConfirm={handleCancelConfirmed}
        onCancel={() => setConfirmCancel(false)}
      />

      <div className="modal-content import-modal">
        <div className="modal-header">
          <h2 className="font-semibold text-lg m-0">Import Document</h2>
          <button
            className="modal-close"
            onClick={() => setConfirmCancel(true)}
            aria-label="Cancel import"
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body import-layout">
          <div className="import-preview">
            {docState.hasThumbnail ? (
              <img src={documentUrls.thumbnail(docState.id)} alt="" />
            ) : (
              <>
                <ImageIcon size={32} className="text-muted mb-2 opacity-50" aria-hidden="true" />
                <span className="text-xs text-muted">No Cover</span>
              </>
            )}
          </div>

          <div className="import-form">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted font-medium uppercase tracking-wider" htmlFor="import-title">
                Title
              </label>
              <input
                id="import-title"
                className="input"
                value={docState.title}
                onChange={(e) => setDocState({ ...docState, title: e.target.value })}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted font-medium uppercase tracking-wider" htmlFor="import-library">
                Library
              </label>
              <select
                id="import-library"
                className="input cursor-pointer"
                value={selectedLibraryId}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedLibraryId(
                    value === "" || value === NEW_LIBRARY ? (value as "" | typeof NEW_LIBRARY) : Number(value),
                  );
                  setSelectedCollectionId("");
                }}
              >
                <option value="">-- Don't add to library yet --</option>
                {libraries.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                <option value={NEW_LIBRARY}>+ New library...</option>
              </select>
            </div>

            {/* Named here rather than in a separate dialog, so choosing to make
                a library does not interrupt the import that is already open. */}
            {isCreatingLibrary && (
              <div className="flex flex-col gap-1">
                <label
                  className="text-xs text-muted font-medium uppercase tracking-wider"
                  htmlFor="import-new-library"
                >
                  New Library Name
                </label>
                <input
                  id="import-new-library"
                  className="input"
                  placeholder="Library name..."
                  value={newLibraryName}
                  onChange={(e) => setNewLibraryName(e.target.value)}
                  autoFocus
                />
              </div>
            )}

            {typeof selectedLibraryId === "number" &&
              collections[selectedLibraryId as number]?.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label
                    className="text-xs text-muted font-medium uppercase tracking-wider"
                    htmlFor="import-collection"
                  >
                    Collection (Optional)
                  </label>
                  <select
                    id="import-collection"
                    className="input cursor-pointer"
                    value={selectedCollectionId}
                    onChange={(e) =>
                      setSelectedCollectionId(e.target.value === "" ? "" : Number(e.target.value))
                    }
                  >
                    <option value="">-- No collection --</option>
                    {collections[selectedLibraryId as number].map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

            {saveError && (
              <p className="auth-error" role="alert">{saveError}</p>
            )}

            <div className="import-actions">
              <button
                className="btn btn-ghost btn-danger-ghost"
                onClick={() => setConfirmCancel(true)}
              >
                Cancel Import
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={isSaving || (isCreatingLibrary && !newLibraryName.trim())}
              >
                {isSaving ? "Saving..." : "Save Document"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
