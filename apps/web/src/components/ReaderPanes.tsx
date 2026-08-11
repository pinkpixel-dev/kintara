import { MarkdownReader } from "./MarkdownReader";
import { PdfReader } from "./PdfReader";
import type { Document } from "../api";

interface ReaderPanesProps {
  activeDocument: Document | null;
  splitDocument: Document | null;
  isSplitView: boolean;
}

/** Renders one document, picking the reader that matches its type. */
function readerFor(doc: Document | null, inSplitView: boolean) {
  if (!doc) return null;
  if (doc.documentType === 'md' || doc.documentType === 'txt') {
    return <MarkdownReader documentId={doc.id} />;
  }
  if (doc.documentType === 'pdf') {
    return <PdfReader documentId={doc.id} isSplitView={inSplitView} />;
  }
  return <div>Unsupported file format</div>;
}

/**
 * The reading surface: one pane, or two side by side in split view.
 *
 * PDFs sit on the secondary background because the page provides its own white;
 * text formats use `reader-bg`, which carries the separate reader theme.
 */
export function ReaderPanes({ activeDocument, splitDocument, isSplitView }: ReaderPanesProps) {
  return (
    <>
      <div
        className={`flex-1 min-w-0 h-full w-full relative ${
          activeDocument?.documentType === 'pdf' ? 'bg-[var(--bg-secondary)]' : 'reader-bg'
        }`}
      >
        <div className="absolute inset-0 overflow-y-auto">
          {readerFor(activeDocument, isSplitView)}
        </div>
      </div>

      {isSplitView && splitDocument && (
        <div
          className={`flex-1 min-w-0 border-l border-[var(--border-color)] h-full w-full relative ${
            splitDocument.documentType === 'pdf' ? 'bg-[var(--bg-secondary)]' : 'reader-bg'
          }`}
        >
          <div className="absolute inset-0 overflow-y-auto">
            {readerFor(splitDocument, true)}
          </div>
        </div>
      )}
    </>
  );
}
