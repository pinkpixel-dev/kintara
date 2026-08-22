import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { AiFindMode } from "./AiFindMode";
import ReactMarkdown from "react-markdown";
import { ApiError, aiService, type AiConversation, type Document, type SummaryPreflight } from "../api";
import {
  AI_PANEL_MAX_WIDTH,
  AI_PANEL_MIN_WIDTH,
  AI_PANEL_WIDTH_KEY,
  clampAiPanelWidth,
  loadAiPanelWidth,
} from "../lib/ai-panel-size";
import { withPendingUserMessage } from "../lib/ai-conversation";

interface Props {
  document: Document;
  onClose: () => void;
  onUpdated: (document: Document) => void;
}

export function AiPanel({ document, onClose, onUpdated }: Props) {
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [preflight, setPreflight] = useState<SummaryPreflight | null>(null);
  const [confirmSummary, setConfirmSummary] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "find">("chat");
  const [width, setWidth] = useState(() =>
    loadAiPanelWidth(typeof localStorage === "undefined" ? null : localStorage));
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConversation(null);
    setPreflight(null);
    setConfirmSummary(false);
    setDraft("");
    setError(null);
    setMode("chat");
    Promise.all([aiService.conversation(document.id), aiService.preflight(document.id)])
      .then(([nextConversation, nextPreflight]) => {
        setConversation(nextConversation);
        setPreflight(nextPreflight);
      })
      .catch((err) => setError(messageFor(err, "Could not load this conversation.")));
  }, [document.id]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTo({
      top: transcript.scrollHeight,
      behavior: busy ? "auto" : "smooth",
    });
  }, [conversation?.messages.length, busy]);

  const ask = async () => {
    const message = draft.trim();
    if (!message || busy) return;
    const previousConversation = conversation;
    setConversation(withPendingUserMessage(conversation, document.id, message));
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      const response = await aiService.ask(document.id, message);
      setConversation(response.conversation);
    } catch (err) {
      setConversation(previousConversation);
      setDraft(message);
      setError(messageFor(err, "The question could not be sent."));
    } finally {
      setBusy(false);
    }
  };

  const summarize = async () => {
    if (!preflight || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await aiService.summarizeInChat(document.id, preflight.hasSummary);
      setConversation(response.conversation);
      if (response.updatedDocument) onUpdated(response.updatedDocument);
      setPreflight({ ...preflight, hasSummary: true });
      setConfirmSummary(false);
    } catch (err) {
      setError(messageFor(err, "The summary could not be generated."));
    } finally {
      setBusy(false);
    }
  };

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = width;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => {
      setWidth(clampAiPanelWidth(startWidth + startX - next.clientX, window.innerWidth));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      setWidth((current) => {
        localStorage.setItem(AI_PANEL_WIDTH_KEY, String(current));
        return current;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? 1 : -1;
    const next = clampAiPanelWidth(width + direction * 24, window.innerWidth);
    setWidth(next);
    localStorage.setItem(AI_PANEL_WIDTH_KEY, String(next));
  };

  return (
    <aside className="ai-panel" style={{ width }} aria-label="Document chat">
      <div className="ai-resize-handle" role="separator" aria-label="Resize AI chat"
        aria-orientation="vertical" aria-valuemin={AI_PANEL_MIN_WIDTH}
        aria-valuemax={AI_PANEL_MAX_WIDTH} aria-valuenow={width} tabIndex={0}
        onPointerDown={resize} onKeyDown={resizeWithKeyboard} />
      <header className="ai-chat-header">
        <span className="ai-panel-title"><Bot size={17} /> Ask Kintara</span>
        <button className="modal-close" onClick={onClose} aria-label="Close AI chat">
          <X size={18} />
        </button>
      </header>
      <div className="ai-document-name" title={document.title}>{document.title}</div>

      <div className="ai-mode" role="group" aria-label="AI mode">
        <button
          type="button"
          className={mode === "chat" ? "search-mode-option active" : "search-mode-option"}
          aria-pressed={mode === "chat"}
          onClick={() => setMode("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          className={mode === "find" ? "search-mode-option active" : "search-mode-option"}
          aria-pressed={mode === "find"}
          onClick={() => setMode("find")}
        >
          Find
        </button>
      </div>

      {mode === "find" && <AiFindMode document={document} preflight={preflight} />}

      {mode === "chat" && <>
      <div className="ai-transcript" ref={transcriptRef} aria-live="polite">
        {conversation?.messages.map((message) => (
          <article key={message.id} className={message.role === "user"
            ? "ai-message ai-message-user" : "ai-message ai-message-assistant"}>
            <div className="ai-message-body"><ReactMarkdown>{message.content}</ReactMarkdown></div>
            {message.citations.length > 0 && (
              <div className="ai-citations" aria-label="Sources">
                {message.citations.map((citation) => (
                  <span key={citation.page} className="ai-citation"
                    title={citation.excerpt || undefined}>Page {citation.page}</span>
                ))}
              </div>
            )}
          </article>
        ))}
        {busy && <div className="ai-thinking" role="status">
          <span /><span /><span /><span className="sr-only">Thinking</span>
        </div>}
      </div>

      {confirmSummary && preflight && (
        <section className="ai-request-confirmation" aria-label="Confirm summary request">
          <strong>Confirm provider request</strong>
          <dl>
            <div><dt>Provider</dt><dd>{preflight.provider === "openai" ? "OpenAI" : "Google"}</dd></div>
            <div><dt>Model</dt><dd>{preflight.model}</dd></div>
            <div><dt>Input</dt><dd>~{preflight.approximateInputTokens.toLocaleString()} tokens</dd></div>
          </dl>
          {preflight.hasSummary && <p>This document already has a summary. Replace it?</p>}
          <div className="settings-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmSummary(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy} onClick={summarize}>Send</button>
          </div>
        </section>
      )}

      {error && <p className="auth-error ai-chat-error" role="alert">{error}</p>}
      <div className="ai-composer">
        <div className="ai-composer-field">
          <textarea value={draft} maxLength={2000} rows={2}
            placeholder="Ask about this document…" aria-label="Ask about this document"
            disabled={busy} onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                ask();
              }
            }} />
          <button className="ai-send" onClick={ask} disabled={busy || !draft.trim()}
            aria-label="Send question"><Send size={17} /></button>
        </div>
        {preflight?.canSummarize && (
          <button className="ai-quick-action" disabled={busy || confirmSummary}
            onClick={() => setConfirmSummary(true)}>
            <Sparkles size={15} /> Summarize
          </button>
        )}
      </div>
      </>}
    </aside>
  );
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}
