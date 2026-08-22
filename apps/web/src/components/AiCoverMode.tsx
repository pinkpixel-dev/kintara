import { useEffect, useState } from "react";
import { Check, ImagePlus, PenLine, RefreshCw, X } from "lucide-react";
import {
  ApiError,
  aiService,
  documentService,
  type CoverCandidate,
  type Document,
  type SummaryPreflight,
} from "../api";
import {
  MAX_CUSTOM_COVER_PROMPT_CHARS,
  canSubmitCustomCoverPrompt,
  coverPromptLength,
  limitCoverPrompt,
} from "../lib/cover-generation";

interface Props {
  document: Document;
  /** Passed by the AI panel; omitted in Details, where this component loads it. */
  preflight?: SummaryPreflight | null;
  onUpdated: (document: Document) => void;
  embedded?: boolean;
}

interface GenerationRequest {
  customPrompt?: string;
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
export function AiCoverMode({ document, preflight, onUpdated, embedded = false }: Props) {
  const [loadedPreflight, setLoadedPreflight] = useState<SummaryPreflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CoverCandidate | null>(null);
  const [candidateRequest, setCandidateRequest] = useState<GenerationRequest | null>(null);
  const [confirming, setConfirming] = useState<GenerationRequest | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPreflight = preflight === undefined ? loadedPreflight : preflight;

  useEffect(() => {
    setCandidate(null);
    setCandidateRequest(null);
    setConfirming(null);
    setPromptOpen(false);
    setCustomPrompt("");
    setError(null);
  }, [document.id]);

  useEffect(() => {
    if (preflight !== undefined) return;
    let active = true;
    setLoadedPreflight(null);
    setPreflightError(null);
    aiService.preflight(document.id)
      .then((value) => { if (active) setLoadedPreflight(value); })
      .catch((err) => {
        if (active) {
          setPreflightError(err instanceof ApiError
            ? err.message : "Cover generation is unavailable.");
        }
      });
    return () => { active = false; };
  }, [document.id, preflight]);

  const generate = async (request: GenerationRequest) => {
    if (busy) return;
    const nextRequest = request.customPrompt === undefined
      ? {}
      : { customPrompt: request.customPrompt.trim() };
    setBusy(true);
    setConfirming(null);
    setError(null);
    try {
      setCandidate(await aiService.generateCover(document.id, nextRequest.customPrompt));
      setCandidateRequest(nextRequest);
      setPromptOpen(false);
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
      setCandidateRequest(null);
      if (preflight === undefined) {
        setLoadedPreflight((current) => current ? { ...current, hasCover: true } : current);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That cover could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (preflightError) {
    return <p className="auth-error ai-chat-error" role="alert">{preflightError}</p>;
  }

  if (!currentPreflight) {
    return <div className="ai-thinking" role="status">
      <span /><span /><span /><span className="sr-only">Loading cover options</span>
    </div>;
  }

  if (!currentPreflight.canGenerateCover) {
    return (
      <div className="ai-cover">
        <p className="ai-find-empty">Only an editor can change this document's cover.</p>
      </div>
    );
  }

  const promptLength = coverPromptLength(customPrompt);
  const customReady = canSubmitCustomCoverPrompt(customPrompt);

  return (
    <section className={embedded ? "ai-cover ai-cover-embedded" : "ai-cover"}
      aria-label="AI cover generator">
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
              onClick={() => generate(candidateRequest ?? {})}
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
      ) : confirming !== null ? (
        <section className="ai-request-confirmation" aria-label="Confirm cover request">
          <strong>Confirm provider request</strong>
          <dl>
            <div><dt>Provider</dt><dd>{providerName(currentPreflight.provider)}</dd></div>
            <div><dt>Model</dt><dd>{currentPreflight.imageModel}</dd></div>
          </dl>
          {confirming.customPrompt === undefined ? (
            <p>The title, author, keywords, and summary are sent. Document text is not.</p>
          ) : (
            <>
              <p>Your custom prompt is sent. Document metadata and text are not.</p>
              <blockquote className="ai-cover-prompt-preview">{confirming.customPrompt}</blockquote>
            </>
          )}
          {/* The one call Kintara cannot send with retention disabled. Said
              before it happens rather than buried in the docs. */}
          {currentPreflight.imageStoredByProvider && (
            <p className="ai-cover-retention">
              OpenAI's image endpoint has no retention setting, so unlike every other AI
              request Kintara makes, this prompt is not sent with storage disabled.
            </p>
          )}
          {currentPreflight.hasCover && <p>This document already has a cover. You can compare
            before replacing it.</p>}
          <div className="settings-actions">
            <button className="btn btn-ghost" disabled={busy}
              onClick={() => setConfirming(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}
              onClick={() => generate(confirming)}>Generate</button>
          </div>
        </section>
      ) : promptOpen ? (
        <div className="ai-cover-custom">
          <label htmlFor={`cover-prompt-${document.id}`}>Custom cover prompt</label>
          <textarea
            id={`cover-prompt-${document.id}`}
            value={customPrompt}
            rows={5}
            aria-describedby={`cover-prompt-count-${document.id}`}
            placeholder="Describe the subject, style, colors, composition, and any text you want included."
            onChange={(event) => setCustomPrompt(limitCoverPrompt(event.target.value))}
          />
          <small id={`cover-prompt-count-${document.id}`}>
            {promptLength.toLocaleString()} / {MAX_CUSTOM_COVER_PROMPT_CHARS.toLocaleString()}
          </small>
          <div className="settings-actions">
            <button type="button" className="btn btn-ghost"
              onClick={() => setPromptOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!customReady}
              onClick={() => setConfirming({ customPrompt: customPrompt.trim() })}>
              Review request
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="ai-find-empty">
            {currentPreflight.hasCover
              ? "Generate a different cover from document details or write your own direction."
              : "Generate a cover from document details or write your own direction."}
          </p>
          <div className="ai-cover-start-actions">
            <button type="button" className="btn btn-primary ai-passage-action"
              onClick={() => setConfirming({})} disabled={busy}>
              <ImagePlus size={14} aria-hidden="true" /> Generate from details
            </button>
            <button type="button" className="btn btn-ghost ai-passage-action"
              onClick={() => setPromptOpen(true)} disabled={busy}>
              <PenLine size={14} aria-hidden="true" /> Write a custom prompt
            </button>
          </div>
        </>
      )}

      {busy && (
        <div className="ai-thinking" role="status">
          <span /><span /><span /><span className="sr-only">Generating</span>
        </div>
      )}
      {error && <p className="auth-error ai-chat-error" role="alert">{error}</p>}
    </section>
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
