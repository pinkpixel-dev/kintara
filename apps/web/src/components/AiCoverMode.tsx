import { useEffect, useState } from "react";
import { Check, ImagePlus, RefreshCw, X } from "lucide-react";
import {
  ApiError,
  aiService,
  documentService,
  type CoverCandidate,
  type Document,
  type SummaryPreflight,
} from "../api";

interface Props {
  document: Document;
  preflight: SummaryPreflight | null;
  onUpdated: (document: Document) => void;
}

/**
 * Generate a cover, look at it, then decide.
 *
 * The candidate lives only in this component until it is accepted. Nothing is
 * written to the document, nothing is cached on the server, and closing the
 * panel throws it away — so a cover the reader dislikes costs one generation
 * and leaves no trace.
 *
 * Accepting goes through the ordinary cover upload route rather than a new
 * write path, so a generated image lands exactly like a hand-picked one: same
 * editor check, same format allowlist, same cache-busting filename.
 */
export function AiCoverMode({ document, preflight, onUpdated }: Props) {
  const [candidate, setCandidate] = useState<CoverCandidate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCandidate(null);
    setConfirming(false);
    setError(null);
  }, [document.id]);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setConfirming(false);
    setError(null);
    try {
      setCandidate(await aiService.generateCover(document.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That cover could not be generated.");
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!candidate || saving) return;
    setSaving(true);
    setError(null);
    try {
      await documentService.uploadCover(document.id, fileFor(candidate));
      onUpdated(await documentService.get(document.id));
      setCandidate(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That cover could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (!preflight?.canSummarize) {
    return (
      <div className="ai-cover">
        <p className="ai-find-empty">Only an editor can change this document's cover.</p>
      </div>
    );
  }

  return (
    <div className="ai-cover">
      {candidate ? (
        <>
          <img
            className="ai-cover-preview"
            src={`data:${candidate.mimeType};base64,${candidate.imageBase64}`}
            alt="Suggested cover"
          />
          <p className="ai-find-note">
            {providerName(candidate.provider)} {candidate.model}
            {candidate.storedByProvider && " · retained by the provider"}
          </p>
          <div className="ai-passage-actions">
            <button
              type="button"
              className="btn btn-primary ai-passage-action"
              onClick={accept}
              disabled={saving}
            >
              <Check size={14} aria-hidden="true" /> {saving ? "Saving" : "Use this cover"}
            </button>
            <button
              type="button"
              className="btn btn-ghost ai-passage-action"
              onClick={generate}
              disabled={busy || saving}
            >
              <RefreshCw size={14} aria-hidden="true" /> Regenerate
            </button>
            <button
              type="button"
              className="btn btn-ghost ai-passage-action"
              onClick={() => setCandidate(null)}
              disabled={saving}
            >
              <X size={14} aria-hidden="true" /> Discard
            </button>
          </div>
        </>
      ) : confirming ? (
        <section className="ai-request-confirmation" aria-label="Confirm cover request">
          <strong>Confirm provider request</strong>
          <dl>
            <div><dt>Provider</dt><dd>{providerName(preflight.provider)}</dd></div>
            <div><dt>Model</dt><dd>{preflight.imageModel}</dd></div>
          </dl>
          <p>
            The title, author, keywords, and summary of this document are sent. Its text is
            not.
          </p>
          {/* The one call Kintara cannot send with retention disabled. Said
              before it happens rather than buried in the docs. */}
          {preflight.imageStoredByProvider && (
            <p className="ai-cover-retention">
              OpenAI's image endpoint has no retention setting, so unlike every other AI
              request Kintara makes, this prompt is not sent with storage disabled.
            </p>
          )}
          {preflight.hasCover && <p>This document already has a cover. You can compare
            before replacing it.</p>}
          <div className="settings-actions">
            <button className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy} onClick={generate}>Generate</button>
          </div>
        </section>
      ) : (
        <>
          <p className="ai-find-empty">
            {preflight.hasCover
              ? "Generate a different cover from this document's title, author, and summary."
              : "This document has no cover. Generate one from its title, author, and summary."}
          </p>
          <button
            type="button"
            className="btn btn-primary ai-passage-action"
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            <ImagePlus size={14} aria-hidden="true" /> Generate a cover
          </button>
        </>
      )}

      {busy && (
        <div className="ai-thinking" role="status">
          <span /><span /><span /><span className="sr-only">Generating</span>
        </div>
      )}
      {error && <p className="auth-error ai-chat-error" role="alert">{error}</p>}
    </div>
  );
}

function providerName(provider: string) {
  return provider === "openai" ? "OpenAI" : "Google";
}

/**
 * The candidate as a file the ordinary cover upload will accept.
 *
 * Both providers return base64, and the upload route allowlists by extension,
 * so the filename's suffix has to match what the bytes actually are.
 */
function fileFor(candidate: CoverCandidate): File {
  const binary = atob(candidate.imageBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const extension = candidate.mimeType === "image/png" ? "png"
    : candidate.mimeType === "image/webp" ? "webp"
    : "jpg";
  return new File([bytes], `generated-cover.${extension}`, { type: candidate.mimeType });
}
