import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Bot, MessageSquarePlus, Send, Sparkles, X } from "lucide-react";
import { AiFindMode } from "./AiFindMode";
import { AiCoverMode } from "./AiCoverMode";
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
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  document: Document;
  settingsRevision: number;
  onClose: () => void;
  onUpdated: (document: Document) => void;
}

export function AiPanel({ document, settingsRevision, onClose, onUpdated }: Props) {
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [preflight, setPreflight] = useState<SummaryPreflight | null>(null);
  const [confirmSummary, setConfirmSummary] = useState(false);
  const [confirmClearChat, setConfirmClearChat] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "find" | "cover">("chat");
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
    aiService.conversation(document.id)
      .then(setConversation)
      .catch((err) => setError(messageFor(err, "Could not load this conversation.")));
  }, [document.id]);

  useEffect(() => {
    setConfirmSummary(false);
    aiService.preflight(document.id)
      .then(setPreflight)
      .catch((err) => setError(messageFor(err, "Could not load AI details for this document.")));
  }, [document.id, settingsRevision]);

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

  const clearChat = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await aiService.clearConversation(document.id);
      setConversation({ conversationId: null, documentId: document.id, messages: [] });
      setConfirmClearChat(false);
    } catch (err) {
      setError(messageFor(err, "The chat could not be cleared."));
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
        <div className="ai-header-actions">
          {mode === "chat" && (
            <button className="ai-header-action" onClick={() => setConfirmClearChat(true)}
              disabled={busy || !conversation?.messages.length} aria-label="Start a new chat"
              title="Start a new chat">
              <MessageSquarePlus size={17} />
            </button>
          )}
          <button className="modal-close" onClick={onClose} aria-label="Close AI chat">
            <X size={18} />
          </button>
        </div>
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
        <button
          type="button"
          className={mode === "cover" ? "search-mode-option active" : "search-mode-option"}
          aria-pressed={mode === "cover"}
          onClick={() => setMode("cover")}
        >
          Cover
        </button>
      </div>

      {mode === "find" && <AiFindMode document={document} preflight={preflight} />}
      {mode === "cover" && (
        <AiCoverMode
          document={document}
          preflight={preflight}
          onUpdated={(updated) => {
            onUpdated(updated);
            setPreflight((current) => (current ? { ...current, hasCover: true } : current));
          }}
        />
      )}

      {mode === "chat" && <>
      {preflight?.canSummarize && (
        <div className="ai-chat-actions">
          <button className="ai-summary-action" disabled={busy || confirmSummary}
            aria-expanded={confirmSummary} onClick={() => setConfirmSummary(true)}>
            <Sparkles size={16} /> Summarize document
          </button>
        </div>
      )}

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
      </div>
      </>}
      <ConfirmDialog isOpen={confirmClearChat} title="Start a new chat"
        message="Clear this document’s private chat history? Its saved summary will not be changed."
        confirmLabel="Clear chat" danger onConfirm={clearChat}
        onCancel={() => setConfirmClearChat(false)} />
    </aside>
  );
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}
