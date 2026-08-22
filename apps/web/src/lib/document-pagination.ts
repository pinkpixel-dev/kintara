import type { AiSearchInterpretation, Document, DocumentQuery, Page } from "../api";
import type { ActiveView } from "./empty-reason";
import { extraFiltersFor } from "./ai-search.ts";

export const DOCUMENT_PAGE_SIZE = 50;
const RECENT_DOCUMENT_LIMIT = 10;

export interface DocumentPageState {
  items: Document[];
  total: number;
  /** The next server offset. Kept separately from items.length after deduping. */
  nextOffset: number;
}

export const EMPTY_DOCUMENT_PAGE: DocumentPageState = {
  items: [],
  total: 0,
  nextOffset: 0,
};

export function isFixedRecentView(activeView: ActiveView, searchQuery: string) {
  return activeView.type === "recent" && searchQuery.trim().length === 0;
}

/** Builds the same filtered query for the first page, later pages, and refreshes. */
export function documentQueryFor(
  activeView: ActiveView,
  searchQuery: string,
  interpretation: AiSearchInterpretation | null,
  offset = 0,
): DocumentQuery {
  const query: DocumentQuery = {
    limit: isFixedRecentView(activeView, searchQuery) ? RECENT_DOCUMENT_LIMIT : DOCUMENT_PAGE_SIZE,
    offset,
  };
  const trimmed = searchQuery.trim();

  if (trimmed) query.q = trimmed;
  if (activeView.type === "favorites") query.favorite = true;
  if (activeView.type === "library" && activeView.id) query.libraryId = activeView.id;
  if (activeView.type === "collection" && activeView.id) query.collectionId = activeView.id;
  if (interpretation) Object.assign(query, extraFiltersFor(interpretation));

  return query;
}

function uniqueDocuments(current: Document[], incoming: Document[]) {
  const seen = new Set(current.map((document) => document.id));
  return current.concat(incoming.filter((document) => !seen.has(document.id)));
}

export function replaceDocumentPage(
  page: Page<Document>,
  completeView = false,
): DocumentPageState {
  return {
    items: uniqueDocuments([], page.items),
    // Recent is intentionally a ten-item snapshot. The API total still counts
    // the whole library, which must not turn Recent into another All view.
    total: completeView ? page.items.length : page.total,
    nextOffset: page.offset + page.items.length,
  };
}

export function appendDocumentPage(
  current: DocumentPageState,
  page: Page<Document>,
): DocumentPageState {
  return {
    items: uniqueDocuments(current.items, page.items),
    total: page.total,
    nextOffset: Math.max(current.nextOffset, page.offset + page.items.length),
  };
}

export function hasMoreDocuments(page: DocumentPageState) {
  return page.nextOffset < page.total;
}
