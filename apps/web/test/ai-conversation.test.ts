import test from "node:test";
import assert from "node:assert/strict";

import type { AiConversation } from "../src/api/ai.ts";
import { withPendingUserMessage } from "../src/lib/ai-conversation.ts";

test("a sent question appears after the existing transcript immediately", () => {
  const conversation: AiConversation = {
    conversationId: 14,
    documentId: 8,
    messages: [{
      id: 32,
      role: "assistant",
      kind: "summary",
      content: "Existing summary",
      citations: [{ page: 2, excerpt: "Source" }],
      createdAt: "2026-08-22T12:00:00.000Z",
    }],
  };

  const next = withPendingUserMessage(
    conversation,
    8,
    "What does this mean?",
    -1,
    "2026-08-22T12:01:00.000Z",
  );

  assert.equal(next.conversationId, 14);
  assert.equal(next.messages.length, 2);
  assert.deepEqual(next.messages[1], {
    id: -1,
    role: "user",
    kind: "question",
    content: "What does this mean?",
    citations: [],
    createdAt: "2026-08-22T12:01:00.000Z",
  });
  assert.equal(conversation.messages.length, 1);
});

test("a first question creates a pending transcript for the current document", () => {
  const next = withPendingUserMessage(null, 21, "Start a conversation", -2);

  assert.equal(next.conversationId, null);
  assert.equal(next.documentId, 21);
  assert.equal(next.messages[0]?.content, "Start a conversation");
});
