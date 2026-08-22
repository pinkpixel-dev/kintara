import React, { useEffect, useState, useRef } from "react";
import { pdfAssetOptions, pdfjsLib } from "../lib/pdf";
import { annotationService, documentService, documentUrls, type Annotation } from "../api";
import { highlightBoxes, locatePassage, type TextPiece } from "../lib/pdf-text-locate";
import { onHighlightRequest, onPageRequest, reportHighlight } from "../lib/reader-events";
import "./PdfReader.css";

interface PdfReaderProps {
  documentId: number;
  isSplitView?: boolean;
}

/**
 * Converts one pdf.js text run into canvas coordinates.
 *
 * `item.transform` is in PDF user space, so it goes through the viewport's own
 * matrix first. The run's height comes from the transformed matrix rather than
 * `item.height`, which is unreliable for rotated or scaled text, and its width
 * is the text-space width scaled to the viewport — the same arithmetic pdf.js
 * uses to build its own text layer. Runs without a `transform` are skipped.
 */
function toPiece(item: unknown, viewport: { transform: number[]; scale: number }): TextPiece[] {
  const run = item as { str?: string; transform?: number[]; width?: number; hasEOL?: boolean };
  if (typeof run.str !== "string" || !Array.isArray(run.transform)) return [];
  const tx = pdfjsLib.Util.transform(viewport.transform, run.transform);
  const height = Math.hypot(tx[2], tx[3]);
  return [{
    str: run.str,
    left: tx[4],
    top: tx[5] - height,
    width: (run.width ?? 0) * viewport.scale,
    height,
    endsLine: run.hasEOL === true,
  }];
}

/** Read the current --highlight-color CSS variable from the document root. */
const getHighlightColor = () =>
  getComputedStyle(document.documentElement).getPropertyValue("--highlight-color").trim() ||
  "rgba(234, 179, 8, 0.4)";

export const PdfReader: React.FC<PdfReaderProps> = ({ documentId }) => {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  // Live preview color for the draw-in-progress box
  const [drawColor, setDrawColor] = useState("rgba(234, 179, 8, 0.4)");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * Displayed width divided by the canvas's natural width.
   *
   * The canvas is rendered at a fixed scale and then allowed to shrink to fit
   * narrow screens, so on a phone one CSS pixel is not one canvas pixel.
   * Highlights are stored in canvas coordinates and have to be converted both
   * ways, or they drift off the text as soon as the canvas is scaled.
   */
  const [displayScale, setDisplayScale] = useState(1);
  /** Shown when an accepted passage could not be found on its page. */
  const [placementNotice, setPlacementNotice] = useState<string | null>(null);

  const measureScale = () => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0) setDisplayScale(rect.width / canvas.width);
  };

  const loadAnnotations = async () => {
    try {
      setAnnotations(await documentService.annotations(documentId));
    } catch (err) {
      console.error("Failed to load annotations:", err);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadPdf = async () => {
      try {
        setError(null);
        // Loading by URL rather than by passing bytes lets pdf.js issue Range
        // requests and fetch only the pages it needs, which is the difference
        // between a snappy reader and re-downloading a 200 MB scan per page.
        const loadingTask = pdfjsLib.getDocument({
          url: documentUrls.file(documentId),
          ...pdfAssetOptions,
        });
        const doc = await loadingTask.promise;
        if (cancelled) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNumber(1);
        loadAnnotations();
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load PDF:", err);
        setError("Failed to load PDF document.");
      }
    };

    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    let renderTask: pdfjsLib.RenderTask | null = null;

    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current) return;
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");

        if (context) {
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          renderTask = page.render({ canvasContext: context, canvas: canvas, viewport });
          await renderTask.promise;
          measureScale();
        }
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException") {
          console.error("Failed to render page:", err);
        }
      }
    };

    renderPage();

    return () => {
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, pageNumber]);

  useEffect(() => {
    window.addEventListener("resize", measureScale);
    return () => window.removeEventListener("resize", measureScale);
  }, []);

  // Reading position is per user on the server now, so it survives switching
  // devices. Recorded on page change rather than on every scroll.
  useEffect(() => {
    if (!pdfDoc || numPages === 0) return;
    const progress = Math.min(1, Math.max(0, pageNumber / numPages));
    documentService.setProgress(documentId, progress).catch((err) => {
      console.error("Failed to record reading progress", err);
    });
  }, [documentId, pageNumber, numPages, pdfDoc]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / displayScale;
    const y = (e.clientY - rect.top) / displayScale;
    setStartPos({ x, y });
    setIsDrawing(true);
    setCurrentBox({ x, y, w: 0, h: 0 });
    // Snapshot the current color when drawing starts
    setDrawColor(getHighlightColor());
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !startPos) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / displayScale;
    const y = (e.clientY - rect.top) / displayScale;

    setCurrentBox({
      x: Math.min(startPos.x, x),
      y: Math.min(startPos.y, y),
      w: Math.abs(x - startPos.x),
      h: Math.abs(y - startPos.y),
    });
  };

  const handleMouseUp = async () => {
    setIsDrawing(false);
    if (currentBox && currentBox.w * displayScale > 10 && currentBox.h * displayScale > 10) {
      try {
        const color = getHighlightColor();
        const serialized = JSON.stringify({ page: pageNumber, ...currentBox });
        await annotationService.create({
          documentId,
          annotationType: "highlight",
          serializedPosition: serialized,
          content: null,
          color,
        });
        await loadAnnotations();
      } catch (err) {
        console.error("Failed to save annotation", err);
      }
    }
    setCurrentBox(null);
  };

  /**
   * Places an accepted AI passage as a real highlight.
   *
   * The quote was already verified against the server's extracted text, but the
   * boxes have to come from pdf.js, so it can still fail to place here — a page
   * whose text is drawn out of order, for instance. That is reported rather
   * than swallowed: the reader is moved to the page either way, so the passage
   * is at least in front of them.
   */
  useEffect(() => {
    if (!pdfDoc) return;
    return onHighlightRequest(documentId, async ({ page, excerpt }) => {
      setPageNumber(Math.min(Math.max(1, page), pdfDoc.numPages));
      setPlacementNotice(null);
      let boxes: ReturnType<typeof locatePassage> = [];
      try {
        const pdfPage = await pdfDoc.getPage(page);
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        const content = await pdfPage.getTextContent();
        boxes = locatePassage(content.items.flatMap((item) => toPiece(item, viewport)), excerpt);
      } catch (err) {
        console.error("Failed to read page text", err);
      }

      if (boxes.length === 0) {
        setPlacementNotice(`That passage could not be located on page ${page}.`);
        reportHighlight({ documentId, excerpt, placed: false });
        return;
      }

      try {
        await annotationService.create({
          documentId,
          annotationType: "highlight",
          serializedPosition: JSON.stringify({ page, boxes }),
          content: excerpt,
          color: getHighlightColor(),
        });
        await loadAnnotations();
        reportHighlight({ documentId, excerpt, placed: true });
      } catch (err) {
        console.error("Failed to save annotation", err);
        setPlacementNotice("That highlight could not be saved.");
        reportHighlight({ documentId, excerpt, placed: false });
      }
    });
  }, [documentId, pdfDoc]);

  useEffect(() => {
    if (!pdfDoc) return;
    return onPageRequest(documentId, ({ page }) => {
      setPageNumber(Math.min(Math.max(1, page), pdfDoc.numPages));
    });
  }, [documentId, pdfDoc]);

  /** Click on an existing PDF highlight box → delete it. */
  const handleAnnotationClick = async (e: React.MouseEvent, annId: number) => {
    e.stopPropagation();
    try {
      await annotationService.remove(annId);
      await loadAnnotations();
    } catch (err) {
      console.error("Failed to delete annotation", err);
    }
  };

  if (error) return <div className="reader-error">{error}</div>;

  return (
    <div className="pdf-reader-container">
      {/*
        pdf-content-wrapper sizes itself to the canvas's natural pixel width.
        Both the controls bar and the canvas sit inside it, so the controls
        always perfectly match the canvas width. The outer container uses
        margin: auto to horizontally center this wrapper in any panel width.
      */}
      <div className="pdf-content-wrapper">
        <div className="pdf-controls">
          <button
            className="btn btn-ghost px-3 py-1"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((prev) => Math.max(1, prev - 1))}
          >
            Previous
          </button>
          <span className="text-sm font-medium text-primary">
            Page {pageNumber} of {numPages}
          </span>
          <button
            className="btn btn-ghost px-3 py-1"
            disabled={pageNumber >= numPages}
            onClick={() => setPageNumber((prev) => Math.min(numPages, prev + 1))}
          >
            Next
          </button>
        </div>

        {placementNotice && (
          <p className="pdf-placement-notice" role="status">
            {placementNotice}
            <button
              type="button"
              className="pdf-placement-dismiss"
              onClick={() => setPlacementNotice(null)}
              aria-label="Dismiss"
            >
              Dismiss
            </button>
          </p>
        )}

        <div
          className="pdf-canvas-wrapper"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <canvas ref={canvasRef} style={{ display: "block" }} />

          {annotations.flatMap((ann) =>
            highlightBoxes(ann.serializedPosition, pageNumber).map((box, index) => (
              <div
                key={`${ann.id}-${index}`}
                title="Click to remove highlight"
                onClick={(e) => handleAnnotationClick(e, ann.id)}
                style={{
                  position: "absolute",
                  left: box.x * displayScale,
                  top: box.y * displayScale,
                  width: box.w * displayScale,
                  height: box.h * displayScale,
                  backgroundColor: ann.color || "rgba(234, 179, 8, 0.4)",
                  cursor: "pointer",
                  transition: "opacity 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.5")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              />
            )),
          )}

          {isDrawing && currentBox && (
            <div
              style={{
                position: "absolute",
                left: currentBox.x * displayScale,
                top: currentBox.y * displayScale,
                width: currentBox.w * displayScale,
                height: currentBox.h * displayScale,
                backgroundColor: drawColor,
                border: "1px dashed rgba(0,0,0,0.3)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
