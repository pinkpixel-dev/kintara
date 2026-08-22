/**
 * Messages between the AI panel and whichever reader is showing a document.
 *
 * The panel knows which passage the reader picked; only the reader can place a
 * highlight, because only it has the rendered page and its text runs. Rather
 * than lift the whole pdf.js document into shared state for one action, the two
 * talk over window events — the same pattern the sidebar and `App` already use.
 *
 * Every message carries a `documentId` and every handler ignores messages for
 * anything else, so a second reader open in split view stays out of it.
 */

export interface HighlightRequest {
  documentId: number;
  page: number;
  excerpt: string;
}

export interface HighlightOutcome {
  documentId: number;
  excerpt: string;
  /** False when the reader could not find that text on that page. */
  placed: boolean;
}

export interface PageRequest {
  documentId: number;
  page: number;
}

const HIGHLIGHT = "kintara:highlight-passage";
const OUTCOME = "kintara:highlight-outcome";
const GO_TO_PAGE = "kintara:go-to-page";

function emit<T>(name: string, detail: T) {
  window.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

function listen<T extends { documentId: number }>(
  name: string,
  documentId: number,
  handler: (detail: T) => void,
): () => void {
  const wrapped = (event: Event) => {
    const detail = (event as CustomEvent<T>).detail;
    if (detail && detail.documentId === documentId) handler(detail);
  };
  window.addEventListener(name, wrapped);
  return () => window.removeEventListener(name, wrapped);
}

export const requestHighlight = (detail: HighlightRequest) => emit(HIGHLIGHT, detail);
export const reportHighlight = (detail: HighlightOutcome) => emit(OUTCOME, detail);
export const requestPage = (detail: PageRequest) => emit(GO_TO_PAGE, detail);

export const onHighlightRequest = (documentId: number, handler: (d: HighlightRequest) => void) =>
  listen(HIGHLIGHT, documentId, handler);
export const onHighlightOutcome = (documentId: number, handler: (d: HighlightOutcome) => void) =>
  listen(OUTCOME, documentId, handler);
export const onPageRequest = (documentId: number, handler: (d: PageRequest) => void) =>
  listen(GO_TO_PAGE, documentId, handler);
