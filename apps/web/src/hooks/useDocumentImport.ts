import { useRef, useState } from "react";
import { documentService, type Document } from "../api";
import type { ImportTarget } from "../components/Sidebar";

/**
 * The import flow, from file picker to filed document.
 *
 * Kept together because the steps share state that is meaningless apart: the
 * target chosen before the picker opens has to survive the upload to reach the
 * modal, and the modal only exists once the server has returned a document to
 * edit. The upload happens before the modal on purpose — the server needs the
 * bytes to read metadata and render a cover, and the modal then edits the
 * result.
 */
export function useDocumentImport() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importingDoc, setImportingDoc] = useState<Document | null>(null);
  const [target, setTarget] = useState<ImportTarget | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Opens the file picker, remembering where the result should land. */
  const start = (next?: ImportTarget) => {
    setTarget(next ?? null);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    event.target.value = "";
    if (!file) return;

    setError(null);
    setIsUploading(true);
    try {
      setImportingDoc(await documentService.upload(file));
    } catch (err) {
      console.error("Failed to import document", err);
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const finish = () => {
    setImportingDoc(null);
    setTarget(null);
  };

  return {
    fileInputRef,
    importingDoc,
    target,
    isUploading,
    error,
    start,
    finish,
    dismissError: () => setError(null),
    handleFileSelected,
  };
}
