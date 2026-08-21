import type { RefObject } from "react";

interface ImportOverlaysProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelected: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isUploading: boolean;
  error: string | null;
  onDismissError: () => void;
}

/**
 * The file picker and the two states an import can be in before its modal
 * appears: uploading, or failed.
 */
export function ImportOverlays({
  fileInputRef,
  onFileSelected,
  isUploading,
  error,
  onDismissError,
}: ImportOverlaysProps) {
  return (
    <>
      {/* The browser's file picker replaces the desktop build's native dialog.
          `multiple` is the whole of the bulk import's entry point: picking one
          file behaves exactly as it did, picking several opens the batch flow
          instead, so there is no second Import control to explain. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.md,.txt"
        multiple
        className="hidden"
        onChange={onFileSelected}
      />

      {isUploading && (
        <div className="fixed-overlay z-100" role="status" aria-live="polite">
          <div className="modal-content" style={{ maxWidth: "320px" }}>
            <div className="modal-body text-center">
              <p className="text-sm text-secondary m-0">Uploading and indexing…</p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed-overlay z-100" role="alertdialog" aria-modal="true">
          <div className="modal-content" style={{ maxWidth: "420px" }}>
            <div className="modal-header">
              <h2 className="font-semibold text-base m-0">Import failed</h2>
            </div>
            <div className="modal-body">
              <p className="text-sm text-secondary m-0">{error}</p>
              <div className="flex justify-end mt-6">
                <button className="btn btn-primary" onClick={onDismissError} autoFocus>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
