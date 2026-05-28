import React, { useEffect, useState, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { invoke } from "@tauri-apps/api/core";
import { annotationService, Annotation } from "../db";
import "./PdfReader.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface PdfReaderProps {
  documentId: number;
  filePath: string;
  isSplitView?: boolean;
}

export const PdfReader: React.FC<PdfReaderProps> = ({ documentId, filePath, isSplitView = false }) => {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  
  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{x: number, y: number} | null>(null);
  const [currentBox, setCurrentBox] = useState<{x: number, y: number, w: number, h: number} | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const loadAnnotations = async () => {
    try {
      const anns = await annotationService.getByDocument(documentId);
      setAnnotations(anns);
    } catch (err) {
      console.error("Failed to load annotations:", err);
    }
  };

  useEffect(() => {
    const loadPdf = async () => {
      try {
        setError(null);
        const data = await invoke<number[]>("read_file_from_library", { filePath });
        const fileData = new Uint8Array(data);
        const loadingTask = pdfjsLib.getDocument({ data: fileData });
        const doc = await loadingTask.promise;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNumber(1);
        loadAnnotations();
      } catch (err) {
        console.error("Failed to load PDF:", err);
        setError("Failed to load PDF document.");
      }
    };
    loadPdf();
  }, [filePath, documentId]);

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
        }
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
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

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setStartPos({ x, y });
    setIsDrawing(true);
    setCurrentBox({ x, y, w: 0, h: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !startPos) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setCurrentBox({
      x: Math.min(startPos.x, x),
      y: Math.min(startPos.y, y),
      w: Math.abs(x - startPos.x),
      h: Math.abs(y - startPos.y)
    });
  };

  const handleMouseUp = async () => {
    setIsDrawing(false);
    if (currentBox && currentBox.w > 10 && currentBox.h > 10) {
      try {
        const serialized = JSON.stringify({ page: pageNumber, ...currentBox });
        await annotationService.create({
          document_id: documentId,
          annotation_type: "highlight",
          serialized_position: serialized,
          content: null,
          color: "rgba(255, 235, 59, 0.4)"
        });
        await loadAnnotations();
      } catch (err) {
        console.error("Failed to save annotation", err);
      }
    }
    setCurrentBox(null);
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
            onClick={() => setPageNumber(prev => Math.max(1, prev - 1))}
          >
            Previous
          </button>
          <span className="text-sm font-medium text-primary">
            Page {pageNumber} of {numPages}
          </span>
          <button
            className="btn btn-ghost px-3 py-1"
            disabled={pageNumber >= numPages}
            onClick={() => setPageNumber(prev => Math.min(numPages, prev + 1))}
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
          <canvas ref={canvasRef} style={{ display: 'block' }} />

          {annotations.map(ann => {
            const pos = JSON.parse(ann.serialized_position);
            if (pos.page !== pageNumber) return null;
            return (
              <div
                key={ann.id}
                style={{
                  position: 'absolute',
                  left: pos.x,
                  top: pos.y,
                  width: pos.w,
                  height: pos.h,
                  backgroundColor: ann.color || "rgba(255, 235, 59, 0.4)",
                  pointerEvents: 'none'
                }}
              />
            );
          })}

          {isDrawing && currentBox && (
            <div
              style={{
                position: 'absolute',
                left: currentBox.x,
                top: currentBox.y,
                width: currentBox.w,
                height: currentBox.h,
                backgroundColor: "rgba(255, 235, 59, 0.4)",
                border: "1px dashed rgba(0,0,0,0.3)",
                pointerEvents: 'none'
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
