import { useEffect, useState } from "react";
import { Bot, X } from "lucide-react";
import { ApiError, aiService, type Document, type SummaryPreflight } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  document: Document | null;
  onClose: () => void;
  onUpdated: (document: Document) => void;
}

export function AiPanel({ document, onClose, onUpdated }: Props) {
  const [preflight, setPreflight] = useState<SummaryPreflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  useEffect(() => { setPreflight(null); setError(null); }, [document?.id]);

  const prepare = async () => {
    if (!document) return;
    setBusy(true); setError(null);
    try { setPreflight(await aiService.preflight(document.id)); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not prepare the summary."); }
    finally { setBusy(false); }
  };

  const summarize = async () => {
    if (!document || !preflight) return;
    setBusy(true); setError(null);
    try { const updated = await aiService.summarize(document.id, preflight.hasSummary); onUpdated(updated); setPreflight(null); }
    catch (err) { setError(err instanceof ApiError ? err.message : "The summary could not be generated."); }
    finally { setBusy(false); }
  };

  const requestSummary = () => {
    if (preflight?.hasSummary) setConfirmOverwrite(true);
    else summarize();
  };

  return <aside className="ai-panel" aria-label="AI tools">
    <ConfirmDialog isOpen={confirmOverwrite} title="Replace summary"
      message="This document already has a summary. Replace it with the generated summary?"
      confirmLabel="Replace" onConfirm={() => { setConfirmOverwrite(false); summarize(); }}
      onCancel={() => setConfirmOverwrite(false)} />
    <div className="inspector-header"><span className="ai-panel-title"><Bot size={17} /> AI tools</span>
      <button className="modal-close" onClick={onClose} aria-label="Close AI tools"><X size={18} /></button>
    </div>
    <div className="inspector-content">
      {!document ? <p className="text-sm text-muted">Open a document to use AI tools.</p> : <>
        <h3 className="ai-document-title">{document.title}</h3>
        {!preflight ? <button className="btn btn-primary ai-primary-action" disabled={busy} onClick={prepare}>{busy ? "Checking…" : "Summarize"}</button> :
          <div className="ai-confirmation">
            <strong>Confirm provider request</strong>
            <dl><div><dt>Provider</dt><dd>{preflight.provider === "openai" ? "OpenAI" : "Google"}</dd></div>
              <div><dt>Model</dt><dd>{preflight.model}</dd></div>
              <div><dt>Approx. input</dt><dd>{preflight.approximateInputTokens.toLocaleString()} tokens</dd></div></dl>
            {preflight.hasSummary && <p className="ai-warning">This will replace the existing summary.</p>}
            <div className="settings-actions"><button className="btn btn-ghost" onClick={() => setPreflight(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy} onClick={requestSummary}>{busy ? "Summarizing…" : "Confirm and send"}</button></div>
          </div>}
        {document.summary && <section className="ai-current-summary"><h4>Current summary</h4><p>{document.summary}</p></section>}
      </>}
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  </aside>;
}
