import { useState } from "react";
import { ApiError, aiService, type AiSearchInterpretation, type DocumentQuery } from "../api";
import { extraFiltersFor, scopeFor, viewForInterpretation } from "../lib/ai-search";
import type { ActiveView } from "../lib/empty-reason";

interface Options {
  activeView: ActiveView;
  searchQuery: string;
  setActiveView: (view: ActiveView) => void;
  setSearchQuery: (query: string) => void;
  /** Runs after an interpretation has been applied to the view. */
  onApplied: () => void;
}

/** What the library looked like before the rewrite, so Undo can put it back. */
interface Previous {
  view: ActiveView;
  query: string;
}

export interface AiSearchState {
  interpretation: AiSearchInterpretation | null;
  busy: boolean;
  error: string | null;
  run: (request: string) => Promise<void>;
  undo: () => void;
  clear: () => void;
  /** Adds the filters the sidebar's own views cannot express. */
  applyTo: (query: DocumentQuery) => void;
}

/**
 * Natural-language library search.
 *
 * The rewrite is applied to the ordinary document list rather than replacing it
 * with a separate result surface: the view, the query text, and the extra
 * filters all end up where a manual search would have put them. That is also
 * why the previous scope is kept — an interpretation the reader disagrees with
 * has to be reversible in one click, not something they unpick by hand.
 */
export function useAiSearch({
  activeView,
  searchQuery,
  setActiveView,
  setSearchQuery,
  onApplied,
}: Options): AiSearchState {
  const [interpretation, setInterpretation] = useState<AiSearchInterpretation | null>(null);
  const [previous, setPrevious] = useState<Previous | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = () => {
    setInterpretation(null);
    setPrevious(null);
    setError(null);
  };

  const run = async (request: string) => {
    const trimmed = request.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    // Captured before the view moves, so Undo restores where the reader was
    // rather than where the rewrite sent them.
    const from: Previous = { view: activeView, query: searchQuery };
    try {
      const result = await aiService.search(trimmed, scopeFor(activeView));
      setInterpretation(result);
      setPrevious(from);
      setActiveView(viewForInterpretation(result));
      setSearchQuery(result.terms);
      onApplied();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That search could not be interpreted.");
    } finally {
      setBusy(false);
    }
  };

  const undo = () => {
    if (previous) {
      setActiveView(previous.view);
      setSearchQuery(previous.query);
    }
    clear();
  };

  const applyTo = (query: DocumentQuery) => {
    if (interpretation) Object.assign(query, extraFiltersFor(interpretation));
  };

  return { interpretation, busy, error, run, undo, clear, applyTo };
}
