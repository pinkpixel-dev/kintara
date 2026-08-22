import { useEffect, useState } from "react";
import { CornerUpRight, Highlighter, Search } from "lucide-react";
import { ApiError, aiService, type AiPassage, type Document, type SummaryPreflight } from "../api";
import { onHighlightOutcome, requestHighlight, requestPage } from "../lib/reader-events";

interface Props {
  document: Document;
  preflight: SummaryPreflight | null;
}

/** What happened to each passage the reader tried to highlight. */
type Placement = "placing" | "placed" | "failed";

/**
 * Find passages in the open document.
 *
 * Separate from chat because the output is different in kind: quotes the reader
 * can act on rather than prose they read. Nothing is written until they press
 * Highlight — a suggestion that silently created an annotation would make the
 * model an editor of their document rather than a reader of it.
 */
export function AiFindMode({ document, preflight }: Props) {
  const [draft, setDraft] = useState("");
  const [passages, setPassages] = useState<AiPassage[] | null>(null);
  const [placements, setPlacements] = useState<Record<string, Placement>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPassages(null);
    setPlacements({});
    setDraft("");
    setError(null);
  }, [document.id]);

  // The reader owns the outcome: only it knows whether the text could be found
  // on the rendered page.
  useEffect(
    () =>
      onHighlightOutcome(document.id, ({ excerpt, placed }) => {
        setPlacements((current) => ({ ...current, [excerpt]: placed ? "placed" : "failed" }));
      }),
    [document.id],
  );

  const find = async () => {
    const request = draft.trim();
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await aiService.find(document.id, request);
      setPassages(response.passages);
      setPlacements({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That search could not be run.");
    } finally {
      setBusy(false);
    }
  };

  const highlight = (passage: AiPassage) => {
    setPlacements((current) => ({ ...current, [passage.excerpt]: "placing" }));
    requestHighlight({ documentId: document.id, page: passage.page, excerpt: passage.excerpt });
  };

  const isPdf = document.documentType === "pdf";

  return (
    <div className="ai-find">
      <div className="ai-find-query">
        <div className="ai-composer-field">
          <textarea
            value={draft}
            maxLength={500}
            rows={2}
            placeholder="What should I find in this document?"
            aria-label="What should I find in this document?"
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                find();
              }
            }}
          />
          <button
            className="ai-send"
            onClick={find}
            disabled={busy || !draft.trim()}
            aria-label="Find passages"
          >
            <Search size={17} />
          </button>
        </div>
        {preflight && (
          <p className="ai-find-note">
            Sends this document (~{preflight.approximateInputTokens.toLocaleString()} tokens) to{" "}
            {preflight.provider === "openai" ? "OpenAI" : "Google"} {preflight.model}.
          </p>
        )}
      </div>

      {error && <p className="auth-error ai-chat-error" role="alert">{error}</p>}

      {busy && (
        <div className="ai-thinking" role="status">
          <span /><span /><span /><span className="sr-only">Searching</span>
        </div>
      )}

      {passages?.length === 0 && !busy && (
        <p className="ai-find-empty" role="status">
          Nothing in this document answers that.
        </p>
      )}

      <div className="ai-find-results">
        {passages?.map((passage) => {
          const placement = placements[passage.excerpt];
          return (
            <article key={`${passage.page}-${passage.excerpt}`} className="ai-passage">
              <header className="ai-passage-head">
                <span className="ai-citation">Page {passage.page}</span>
                {placement === "placed" && (
                  <span className="ai-passage-state" role="status">Highlighted</span>
                )}
                {placement === "failed" && (
                  <span className="ai-passage-state ai-passage-state-failed" role="status">
                    Could not place
                  </span>
                )}
              </header>
              <blockquote className="ai-passage-quote">{passage.excerpt}</blockquote>
              {passage.note && <p className="ai-passage-note">{passage.note}</p>}
              <div className="ai-passage-actions">
                <button
                  type="button"
                  className="btn btn-ghost ai-passage-action"
                  onClick={() => highlight(passage)}
                  disabled={placement === "placing" || placement === "placed"}
                >
                  <Highlighter size={14} aria-hidden="true" />
                  {placement === "placed" ? "Highlighted" : "Highlight"}
                </button>
                {isPdf && (
                  <button
                    type="button"
                    className="btn btn-ghost ai-passage-action"
                    onClick={() => requestPage({ documentId: document.id, page: passage.page })}
                  >
                    <CornerUpRight size={14} aria-hidden="true" /> Go to page
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
