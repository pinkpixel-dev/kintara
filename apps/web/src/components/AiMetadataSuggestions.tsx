import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Sparkles, X } from "lucide-react";
import {
  ApiError,
  aiService,
  type Document,
  type MetadataSuggestionCandidate,
  type SummaryPreflight,
} from "../api";
import {
  applySelectedMetadata,
  defaultSelectedFields,
  displayMetadataValue,
  missingSuggestionLabels,
  reviewableSuggestions,
  type MetadataSuggestionField,
} from "../lib/metadata-suggestions";

interface Props {
  document: Document;
  onApply: (document: Document) => void;
}

export function AiMetadataSuggestions({ document, onApply }: Props) {
  const [preflight, setPreflight] = useState<SummaryPreflight | null>(null);
  const [candidate, setCandidate] = useState<MetadataSuggestionCandidate | null>(null);
  const [selected, setSelected] = useState<Set<MetadataSuggestionField>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setPreflight(null);
    setCandidate(null);
    setConfirming(false);
    setPreflightError(null);
    setError(null);
    setMessage(null);
    aiService.preflight(document.id)
      .then((value) => { if (active) setPreflight(value); })
      .catch((err) => {
        if (active) {
          setPreflightError(err instanceof ApiError ? err.message : "Metadata suggestions are unavailable.");
        }
      });
    return () => { active = false; };
  }, [document.id]);

  const suggestions = useMemo(
    () => candidate ? reviewableSuggestions(document, candidate) : [],
    [candidate, document],
  );
  const missing = useMemo(
    () => candidate ? missingSuggestionLabels(candidate) : [],
    [candidate],
  );

  if (preflightError) {
    return <p className="auth-error ai-metadata-feedback" role="alert">{preflightError}</p>;
  }
  if (!preflight?.canSuggestMetadata) return null;

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await aiService.suggestMetadata(document.id, preflight.provider, preflight.model);
      setCandidate(next);
      setSelected(defaultSelectedFields(document, next));
      setConfirming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Metadata suggestions could not be generated.");
      try {
        setPreflight(await aiService.preflight(document.id));
      } catch {
        // Keep the request error visible. The next Details open retries preflight.
      }
    } finally {
      setBusy(false);
    }
  };

  const toggle = (field: MetadataSuggestionField) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const apply = () => {
    onApply(applySelectedMetadata(document, candidate!, selected));
    setCandidate(null);
    setSelected(new Set());
    setMessage("Suggestions applied. Review them, then save details.");
  };

  return (
    <section className="ai-metadata" aria-label="AI metadata suggestions">
      {confirming ? (
        <div className="ai-request-confirmation" aria-label="Confirm metadata request">
          <strong>Confirm provider request</strong>
          <dl>
            <div><dt>Provider</dt><dd>{providerName(preflight.provider)}</dd></div>
            <div><dt>Model</dt><dd>{preflight.model}</dd></div>
            <div><dt>Input</dt><dd>~{preflight.approximateInputTokens.toLocaleString()} tokens</dd></div>
          </dl>
          <p>The document text is sent to your AI provider with storage disabled.</p>
          <div className="settings-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy} onClick={generate}>Generate suggestions</button>
          </div>
        </div>
      ) : candidate ? (
        <div className="ai-metadata-review">
          <div className="ai-metadata-heading">
            <strong>Review suggestions</strong>
            <button className="modal-close" onClick={() => setCandidate(null)} title="Discard suggestions" aria-label="Discard metadata suggestions">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="ai-metadata-note">Nothing changes until you apply suggestions and save details.</p>
          {suggestions.length > 0 ? (
            <div className="ai-metadata-fields">
              {suggestions.map(({ field, label }) => (
                <label className="ai-metadata-field" key={field}>
                  <span className="ai-metadata-field-heading">
                    <input type="checkbox" checked={selected.has(field)} onChange={() => toggle(field)} />
                    <strong>{label}</strong>
                  </span>
                  <span className="ai-metadata-comparison">
                    <small>Current</small><span>{displayMetadataValue(document[field])}</span>
                    <small>Suggested</small><span>{displayMetadataValue(candidate[field])}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="ai-metadata-note">No different metadata suggestions were found.</p>
          )}
          {missing.length > 0 && (
            <p className="ai-metadata-note">No clear {formatList(missing)} found.</p>
          )}
          <div className="ai-metadata-actions">
            <button className="btn btn-primary" disabled={selected.size === 0} onClick={apply}>Apply selected</button>
            <button className="btn btn-ghost" onClick={() => setConfirming(true)}>
              <RefreshCw size={14} aria-hidden="true" /> Generate again
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost ai-metadata-trigger" onClick={() => setConfirming(true)}>
          <Sparkles size={15} aria-hidden="true" /> Suggest metadata with AI
        </button>
      )}

      {busy && <div className="ai-thinking" role="status"><span /><span /><span /><span className="sr-only">Generating suggestions</span></div>}
      {error && <p className="auth-error ai-metadata-feedback" role="alert">{error}</p>}
      {message && <p className="ai-metadata-feedback" role="status">{message}</p>}
    </section>
  );
}

function providerName(provider: string) {
  return provider === "openai" ? "OpenAI" : "Google";
}

function formatList(labels: string[]) {
  if (labels.length < 2) return labels[0] ?? "metadata";
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}
