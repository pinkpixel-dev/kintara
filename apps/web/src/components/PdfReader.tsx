import React, { useEffect, useState, useRef } from "react";
import { pdfAssetOptions, pdfjsLib } from "../lib/pdf";
import { annotationService, documentService, documentUrls, type Annotation } from "../api";
import "./PdfReader.css";

interface PdfReaderProps {
  documentId: number;
  isSplitView?: boolean;
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

  if (error) return <div className="text-red-500 p-4">{error}</div>;

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

        <div
          className="pdf-canvas-wrapper"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <canvas ref={canvasRef} style={{ display: "block" }} />

          {annotations.map((ann) => {
            let pos: any;
            try {
              pos = JSON.parse(ann.serializedPosition);
            } catch {
              return null;
            }
            if (pos.page !== pageNumber) return null;
            return (
              <div
                key={ann.id}
                title="Click to remove highlight"
                onClick={(e) => handleAnnotationClick(e, ann.id)}
                style={{
                  position: "absolute",
                  left: pos.x * displayScale,
                  top: pos.y * displayScale,
                  width: pos.w * displayScale,
                  height: pos.h * displayScale,
                  backgroundColor: ann.color || "rgba(234, 179, 8, 0.4)",
                  cursor: "pointer",
                  transition: "opacity 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.5")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              />
            );
          })}

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
