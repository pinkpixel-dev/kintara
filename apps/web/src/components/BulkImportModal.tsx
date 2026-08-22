import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import {
  collectionService,
  documentService,
  libraryService,
  type Collection,
  type Library,
} from "../api";

/** Sentinel for the "create one" entry in the library picker. */
const NEW_LIBRARY = "new";

interface BulkImportModalProps {
  files: File[];
  /** Preselected when the import was started from a library or collection row. */
  defaultLibraryId?: number;
  defaultCollectionId?: number;
  onClose: () => void;
  onComplete: () => void;
}

interface FileResult {
  name: string;
  error?: string;
}

/**
 * Imports several files at once.
 *
 * The single-file import uploads first and edits afterwards, because the server
 * needs the bytes before it can suggest a title. That does not scale: nobody
 * wants to fill in a form forty times. So this asks the one question that
 * applies to the whole batch — where should these live — before anything is
 * uploaded, and lets the extracted titles stand. Anything that needs correcting
 * afterwards is a card away in the library.
 *
 * Uploads run one at a time on purpose. Each one streams to disk, and a
 * resource-constrained installation should not process forty concurrent
 * uploads.
 */
export function BulkImportModal({
  files,
  defaultLibraryId,
  defaultCollectionId,
  onClose,
  onComplete,
}: BulkImportModalProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [collections, setCollections] = useState<Record<number, Collection[]>>({});
  const [selectedLibraryId, setSelectedLibraryId] = useState<number | "" | typeof NEW_LIBRARY>("");
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | "">(
    defaultCollectionId ?? "",
  );
  const [newLibraryName, setNewLibraryName] = useState("");

  const [phase, setPhase] = useState<"configure" | "running" | "done">("configure");
  const [completed, setCompleted] = useState(0);
  const [failures, setFailures] = useState<FileResult[]>([]);
  const [fatalError, setFatalError] = useState<string | null>(null);

  // A ref rather than state: the upload loop reads it between files, and a
  // state value captured when the loop started would never change.
  const stopRequested = useRef(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [libs, all] = await Promise.all([libraryService.list(), collectionService.list()]);
        setLibraries(libs);

        const grouped: Record<number, Collection[]> = {};
        for (const collection of all) {
          (grouped[collection.libraryId] ??= []).push(collection);
        }
        setCollections(grouped);

        if (defaultLibraryId && libs.some((l) => l.id === defaultLibraryId)) {
          setSelectedLibraryId(defaultLibraryId);
        } else if (libs.length > 0) {
          setSelectedLibraryId(libs[0].id);
        }
      } catch (err) {
        console.error("Failed to load libraries", err);
        setFatalError("Could not load libraries.");
      }
    };
    load();
  }, [defaultLibraryId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Escape must not abandon an import that is already writing files.
      if (e.key === "Escape" && phase === "configure") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, phase]);

  const isCreatingLibrary = selectedLibraryId === NEW_LIBRARY;

  const run = async () => {
    setFatalError(null);
    stopRequested.current = false;

    let libraryId: number | undefined;
    try {
      // Created once, before the loop, so forty documents do not make forty
      // libraries with the same name.
      if (isCreatingLibrary) {
        libraryId = (await libraryService.create({ name: newLibraryName.trim() })).id;
      } else if (selectedLibraryId !== "") {
        libraryId = Number(selectedLibraryId);
      }
    } catch (err) {
      console.error("Failed to create library", err);
      setFatalError(err instanceof Error ? err.message : "Could not create the library.");
      return;
    }

    const placement = {
      ...(libraryId !== undefined ? { libraryId } : {}),
      ...(selectedCollectionId !== "" ? { collectionId: Number(selectedCollectionId) } : {}),
    };

    setPhase("running");
    const failed: FileResult[] = [];

    for (const file of files) {
      if (stopRequested.current) break;
      try {
        // Filed by the upload itself rather than by a follow-up call, so a
        // document can never land in the library unattached to anything.
        await documentService.upload(file, placement);
      } catch (err) {
        console.error("Failed to import", file.name, err);
        failed.push({
          name: file.name,
          error: err instanceof Error ? err.message : "Upload failed.",
        });
      }
      // Counted whether it worked or not: this is progress through the batch,
      // and the failures are listed separately at the end.
      setCompleted((done) => done + 1);
    }

    setFailures(failed);
    setPhase("done");
  };

  const availableCollections =
    typeof selectedLibraryId === "number" ? collections[selectedLibraryId] ?? [] : [];

  const imported = completed - failures.length;
  const stopped = phase === "done" && completed < files.length;

  return (
    <div className="fixed-overlay z-100 animate-in fade-in duration-200" role="dialog" aria-modal="true">
      <div className="modal-content" style={{ maxWidth: "480px" }}>
        <div className="modal-header">
          <h2 className="font-semibold text-lg m-0">
            Import {files.length} documents
          </h2>
          {phase === "configure" && (
            <button
              className="modal-close"
              onClick={onClose}
              aria-label="Cancel import"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="modal-body">
          {phase === "configure" && (
            <>
              <div className="flex flex-col gap-1">
                <label
                  className="text-xs text-muted font-medium uppercase tracking-wider"
                  htmlFor="bulk-library"
                >
                  Library
                </label>
                <select
                  id="bulk-library"
                  className="input cursor-pointer"
                  value={selectedLibraryId}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedLibraryId(
                      value === "" || value === NEW_LIBRARY
                        ? (value as "" | typeof NEW_LIBRARY)
                        : Number(value),
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

              {isCreatingLibrary && (
                <div className="flex flex-col gap-1">
                  <label
                    className="text-xs text-muted font-medium uppercase tracking-wider"
                    htmlFor="bulk-new-library"
                  >
                    New Library Name
                  </label>
                  <input
                    id="bulk-new-library"
                    className="input"
                    placeholder="Library name..."
                    value={newLibraryName}
                    onChange={(e) => setNewLibraryName(e.target.value)}
                    autoFocus
                  />
                </div>
              )}

              {availableCollections.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label
                    className="text-xs text-muted font-medium uppercase tracking-wider"
                    htmlFor="bulk-collection"
                  >
                    Collection (Optional)
                  </label>
                  <select
                    id="bulk-collection"
                    className="input cursor-pointer"
                    value={selectedCollectionId}
                    onChange={(e) =>
                      setSelectedCollectionId(e.target.value === "" ? "" : Number(e.target.value))
                    }
                  >
                    <option value="">-- No collection --</option>
                    {availableCollections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* The list is what makes it obvious you picked the wrong forty
                  files, and it is the only chance to notice before uploading. */}
              <div className="bulk-file-list" role="group" aria-label="Files to import">
                {files.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="bulk-file">
                    <span className="truncate" title={file.name}>{file.name}</span>
                    <span className="text-xs text-muted flex-shrink-0">
                      {formatSize(file.size)}
                    </span>
                  </div>
                ))}
              </div>

              {fatalError && <p className="auth-error" role="alert">{fatalError}</p>}

              <div className="import-actions">
                <button className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={run}
                  disabled={isCreatingLibrary && !newLibraryName.trim()}
                >
                  Import {files.length} documents
                </button>
              </div>
            </>
          )}

          {phase === "running" && (
            <>
              <p className="text-sm text-secondary m-0" role="status" aria-live="polite">
                Uploading {Math.min(completed + 1, files.length)} of {files.length}…
              </p>
              <div
                className="bulk-progress"
                role="progressbar"
                aria-valuenow={completed}
                aria-valuemin={0}
                aria-valuemax={files.length}
              >
                <div
                  className="bulk-progress-bar"
                  style={{ width: `${(completed / files.length) * 100}%` }}
                />
              </div>
              <div className="import-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    stopRequested.current = true;
                  }}
                >
                  Stop after this one
                </button>
              </div>
            </>
          )}

          {phase === "done" && (
            <>
              <div className="bulk-summary">
                <Check size={18} className="text-[var(--accent)]" aria-hidden="true" />
                <span className="text-sm">
                  {imported} of {files.length} imported
                  {stopped ? ", stopped early" : ""}
                </span>
              </div>

              {failures.length > 0 && (
                <>
                  <div className="bulk-summary is-error">
                    <AlertCircle size={18} aria-hidden="true" />
                    <span className="text-sm">
                      {failures.length} could not be imported
                    </span>
                  </div>
                  <div className="bulk-file-list" role="group" aria-label="Failed imports">
                    {failures.map((failure, index) => (
                      <div key={`${failure.name}-${index}`} className="bulk-file">
                        <span className="truncate" title={failure.name}>{failure.name}</span>
                        <span className="text-xs text-muted flex-shrink-0" title={failure.error}>
                          {failure.error}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {stopped && (
                <p className="text-xs text-muted m-0">
                  The documents already imported are in your library; the rest were not
                  uploaded.
                </p>
              )}

              <div className="import-actions">
                <button className="btn btn-primary" onClick={onComplete} autoFocus>
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Rough, and deliberately so — this is a sanity check, not an inventory. */
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
