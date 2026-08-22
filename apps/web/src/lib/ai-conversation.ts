import type { AiConversation, AiMessage } from "../api/ai";

export function withPendingUserMessage(
  conversation: AiConversation | null,
  documentId: number,
  content: string,
  id = -Date.now(),
  createdAt = new Date().toISOString(),
): AiConversation {
  const message: AiMessage = {
    id,
    role: "user",
    kind: "question",
    content,
    citations: [],
    createdAt,
  };

  return {
    conversationId: conversation?.conversationId ?? null,
    documentId,
    messages: [...(conversation?.messages ?? []), message],
  };
}
