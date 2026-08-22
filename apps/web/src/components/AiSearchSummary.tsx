import { Sparkles, Undo2 } from "lucide-react";
import type { AiSearchState } from "../hooks/useAiSearch";
import { describeInterpretation } from "../lib/ai-search";

/**
 * What the model actually searched for, above the results it produced.
 *
 * The rewrite is a guess, so it has to be legible and reversible. The chips
 * name each filter that was applied rather than summarising them, because a
 * reader who asked for one library and got another needs to see which one
 * before they can decide the answer is wrong.
 */
export function AiSearchSummary({ search }: { search: AiSearchState }) {
  const result = search.interpretation;
  if (!result) return null;

  return (
    <section className="ai-search-summary" aria-label="Interpreted search">
      <Sparkles size={15} className="ai-search-summary-icon" aria-hidden="true" />
      <div className="ai-search-summary-body">
        {result.explanation && <p className="ai-search-summary-text">{result.explanation}</p>}
        <ul className="ai-search-chips">
          {describeInterpretation(result).map((filter) => (
            <li key={filter} className="ai-search-chip">{filter}</li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        className="btn btn-ghost ai-search-undo"
        onClick={search.undo}
        title="Undo this interpretation and restore the previous view"
      >
        <Undo2 size={14} aria-hidden="true" /> Undo
      </button>
    </section>
  );
}
