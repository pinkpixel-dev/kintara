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
  onClose: () => void;
  onComplete: () => void;
}

/**
 * Shown after a file has been uploaded, to name it and file it away.
 *
 * The upload has already happened by this point — the server needed the bytes
 * to extract metadata and render a cover — so cancelling here deletes the
 * document rather than simply closing.
 */
export function ImportModal({ document, onClose, onComplete }: ImportModalProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [collections, setCollections] = useState<Record<number, Collection[]>>({});
  const [selectedLibraryId, setSelectedLibraryId] = useState<number | "">("");
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | "">("");
  const [isSaving, setIsSaving] = useState(false);
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

        if (libs.length > 0) setSelectedLibraryId(libs[0].id);
      } catch (err) {
        console.error("Failed to load libraries", err);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (docState.title.trim() && docState.title !== document.title) {
        await documentService.update(document.id, { title: docState.title.trim() });
      }
      if (selectedLibraryId !== "") {
        await libraryService.addDocument(Number(selectedLibraryId), document.id);
      }
      if (selectedCollectionId !== "") {
        await collectionService.addDocument(Number(selectedCollectionId), document.id);
      }
      onComplete();
    } catch (err) {
      console.error("Failed to save document", err);
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

      <div className="modal-content large" style={{ maxWidth: "600px" }}>
        <div className="modal-header">
          <h2 className="font-semibold text-lg m-0">Import Document</h2>
          <button
            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-muted transition-colors border-none bg-transparent cursor-pointer"
            onClick={() => setConfirmCancel(true)}
            aria-label="Cancel import"
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body flex-row gap-6">
          <div className="w-1/3 aspect-4-3 bg-[var(--bg-tertiary)] rounded flex flex-col items-center justify-center border border-dashed border-[var(--border-color)] relative overflow-hidden flex-shrink-0">
            {docState.hasThumbnail ? (
              <img
                src={documentUrls.thumbnail(docState.id)}
                alt=""
                className="object-cover w-full h-full"
              />
            ) : (
              <>
                <ImageIcon size={32} className="text-muted mb-2 opacity-50" aria-hidden="true" />
                <span className="text-xs text-muted">No Cover</span>
              </>
            )}
          </div>

          <div className="flex-1 flex flex-col gap-4">
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
                  setSelectedLibraryId(e.target.value === "" ? "" : Number(e.target.value));
                  setSelectedCollectionId("");
                }}
              >
                <option value="">-- Don't add to library yet --</option>
                {libraries.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedLibraryId !== "" &&
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

            <div className="flex justify-end gap-3 mt-auto pt-4">
              <button
                className="btn btn-ghost text-red-400 hover:text-red-500 hover:bg-red-500/10"
                onClick={() => setConfirmCancel(true)}
              >
                Cancel Import
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Document"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
