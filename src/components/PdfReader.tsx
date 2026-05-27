import React, { useEffect, useState, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { readFile } from "@tauri-apps/plugin-fs";
import "./PdfReader.css";

// Configure the worker. Using the unpkg CDN for the worker to avoid Vite build issues for now.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface PdfReaderProps {
  filePath: string;
}

export const PdfReader: React.FC<PdfReaderProps> = ({ filePath }) => {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const loadPdf = async () => {
      try {
        setError(null);
        // Read file as Uint8Array via Tauri
        const fileData = await readFile(filePath);
        
        // Load the PDF document
        const loadingTask = pdfjsLib.getDocument({ data: fileData });
        const doc = await loadingTask.promise;
        
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNumber(1);
      } catch (err) {
        console.error("Failed to load PDF:", err);
        setError("Failed to load PDF document.");
      }
    };

    loadPdf();
  }, [filePath]);

  useEffect(() => {
    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current) return;

      try {
        const page = await pdfDoc.getPage(pageNumber);
        
        // Calculate scale to fit the container width, default to 1.5 for clarity
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");

        if (context) {
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const renderContext = {
            canvasContext: context,
            viewport: viewport,
          };

          await page.render(renderContext).promise;
        }
      } catch (err) {
        console.error("Failed to render page:", err);
      }
    };

    renderPage();
  }, [pdfDoc, pageNumber]);

  if (error) {
    return <div className="text-red-500 p-4">{error}</div>;
  }

  return (
    <div className="pdf-reader-container flex flex-col items-center">
      {/* Controls */}
      <div className="pdf-controls flex items-center justify-between w-full max-w-2xl mb-4 bg-[var(--bg-secondary)] p-2 rounded-lg border border-[var(--border-color)]">
        <button 
          className="btn btn-ghost px-3 py-1"
          disabled={pageNumber <= 1}
          onClick={() => setPageNumber(prev => Math.max(1, prev - 1))}
        >
          Previous
        </button>
        
        <span className="text-sm font-medium">
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

      {/* Canvas Wrapper */}
      <div className="pdf-canvas-wrapper shadow-md rounded border border-[var(--border-color)] bg-white overflow-hidden">
        <canvas ref={canvasRef} className="max-w-full h-auto" />
      </div>
    </div>
  );
};
