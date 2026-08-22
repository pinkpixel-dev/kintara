import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, documentService, type AiSearchInterpretation, type Document } from "../api";
import type { ActiveView } from "../lib/empty-reason";
import {
  EMPTY_DOCUMENT_PAGE,
  appendDocumentPage,
  documentQueryFor,
  hasMoreDocuments,
  isFixedRecentView,
  replaceDocumentPage,
  type DocumentPageState,
} from "../lib/document-pagination";

interface Options {
  activeView: ActiveView;
  searchQuery: string;
  interpretation: AiSearchInterpretation | null;
}

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : "The documents could not be loaded.";
}

/** Loads document pages and keeps the current scope stable between requests. */
export function useDocumentPagination({ activeView, searchQuery, interpretation }: Options) {
  const [page, setPage] = useState<DocumentPageState>(EMPTY_DOCUMENT_PAGE);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(page);
  const requestVersionRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const retryRef = useRef<"refresh" | "more">("refresh");

  const baseQuery = useMemo(
    () => documentQueryFor(activeView, searchQuery, interpretation),
    [activeView, searchQuery, interpretation],
  );
  const queryKey = JSON.stringify(baseQuery);
  const completeView = isFixedRecentView(activeView, searchQuery);

  const commit = useCallback((next: DocumentPageState) => {
    pageRef.current = next;
    setPage(next);
  }, []);

  const fetchThrough = useCallback(async (targetOffset: number, version: number) => {
    let next = EMPTY_DOCUMENT_PAGE;

    do {
      const response = await documentService.list({ ...baseQuery, offset: next.nextOffset });
      if (version !== requestVersionRef.current) return null;
      next = next.nextOffset === 0
        ? replaceDocumentPage(response, completeView)
        : appendDocumentPage(next, response);
    } while (hasMoreDocuments(next) && next.nextOffset < targetOffset);

    return next;
  }, [queryKey, completeView]);

  const reset = useCallback(async () => {
    const version = ++requestVersionRef.current;
    loadingMoreRef.current = false;
    setIsLoadingMore(false);
    setIsLoading(true);
    setError(null);
    commit(EMPTY_DOCUMENT_PAGE);

    try {
      const next = await fetchThrough(0, version);
      if (next) commit(next);
    } catch (err) {
      if (version === requestVersionRef.current) {
        retryRef.current = "refresh";
        setError(errorMessage(err));
      }
    } finally {
      if (version === requestVersionRef.current) setIsLoading(false);
    }
  }, [fetchThrough, commit]);

  useEffect(() => {
    void reset();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [reset]);

  const refresh = useCallback(async () => {
    const version = ++requestVersionRef.current;
    const targetOffset = Math.max(pageRef.current.nextOffset, baseQuery.limit ?? 0);
    loadingMoreRef.current = false;
    setIsLoadingMore(false);
    setError(null);
    if (pageRef.current.items.length === 0) setIsLoading(true);

    try {
      const next = await fetchThrough(targetOffset, version);
      if (next) commit(next);
    } catch (err) {
      if (version === requestVersionRef.current) {
        retryRef.current = "refresh";
        setError(errorMessage(err));
      }
    } finally {
      if (version === requestVersionRef.current) setIsLoading(false);
    }
  }, [fetchThrough, commit, queryKey]);

  const loadMore = useCallback(async () => {
    const current = pageRef.current;
    if (loadingMoreRef.current || !hasMoreDocuments(current)) return;

    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    setError(null);
    const version = requestVersionRef.current;

    try {
      const response = await documentService.list({ ...baseQuery, offset: current.nextOffset });
      if (version === requestVersionRef.current) commit(appendDocumentPage(current, response));
    } catch (err) {
      if (version === requestVersionRef.current) {
        retryRef.current = "more";
        setError(errorMessage(err));
      }
    } finally {
      loadingMoreRef.current = false;
      if (version === requestVersionRef.current) setIsLoadingMore(false);
    }
  }, [queryKey, commit]);

  const replaceListedDocument = useCallback((updated: Document) => {
    commit({
      ...pageRef.current,
      items: pageRef.current.items.map((item) => item.id === updated.id ? updated : item),
    });
  }, [commit]);

  const retry = useCallback(() => {
    return retryRef.current === "more" ? loadMore() : refresh();
  }, [loadMore, refresh]);

  return {
    documents: page.items,
    total: page.total,
    hasMore: hasMoreDocuments(page),
    isLoading,
    isLoadingMore,
    error,
    loadMore,
    retry,
    refresh,
    replaceListedDocument,
  };
}
