import * as pdfjsLib from "pdfjs-dist";
// Vite resolves this to a hashed URL under /assets and copies the file into the
// build. The desktop version pulled the worker from unpkg, which broke any
// offline use — and a NAS is frequently offline or firewalled.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Runtime resources pdf.js fetches on demand, served from `/pdfjs/` by the
 * plugin in vite.config.ts.
 *
 * Without `wasmUrl`, pdf.js cannot decode JPEG 2000 or JBIG2 images — the two
 * codecs scanners and magazine PDFs reach for most. The page still renders its
 * text and vector art, so the failure looks like "the pictures are missing"
 * rather than an error, and nothing is logged loudly enough to notice.
 *
 * `iccUrl` covers ICC colour profiles, `cMapUrl` CJK text, and
 * `standardFontDataUrl` the base-14 fonts a PDF is allowed to assume exist.
 */
export const pdfAssetOptions = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
} as const;

export { pdfjsLib };
