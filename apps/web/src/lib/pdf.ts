import * as pdfjsLib from "pdfjs-dist";
// Vite resolves this to a hashed URL under /assets and copies the file into the
// build. The desktop version pulled the worker from unpkg, which broke any
// offline use — and a NAS is frequently offline or firewalled.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
