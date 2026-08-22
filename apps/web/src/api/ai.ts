import { api } from "./client";
import type { Document, SortOrder } from "./types";

export type AiProvider = "openai" | "google";

export interface ModelCapability {
  id: string;
  reasoning: string[];
  supportsTemperature: boolean;
}

export interface ModelCatalog {
  openai: ModelCapability[];
  google: ModelCapability[];
}

export interface KeyStatus { set: boolean; hint: string | null }
export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  openaiKey: KeyStatus;
  googleKey: KeyStatus;
  openaiModel: string;
  googleModel: string;
  openaiReasoning: string;
  googleThinking: string;
  temperature: number | null;
  usage: { inputTokens: number; outputTokens: number };
}

export interface UpdateAiSettings {
  enabled: boolean;
  provider: AiProvider;
  openaiModel: string;
  googleModel: string;
  openaiReasoning: string;
  googleThinking: string;
  temperature: number | null;
  openaiApiKey?: string;
  googleApiKey?: string;
  removeOpenaiKey?: boolean;
  removeGoogleKey?: boolean;
}

export interface SummaryPreflight {
  provider: AiProvider;
  model: string;
  approximateInputTokens: number;
  textStatus: string;
  hasSummary: boolean;
  canSummarize: boolean;
}

/**
 * A natural-language request rewritten into the filters the document list
 * already understands. Names travel with the ids so the interpretation can be
 * shown without a second round trip.
 */
export interface AiSearchInterpretation {
  terms: string;
  libraryId: number | null;
  libraryName: string | null;
  collectionId: number | null;
  collectionName: string | null;
  tagId: number | null;
  tagName: string | null;
  favorite: boolean;
  sort: SortOrder;
  explanation: string;
}

export interface AiCitation { page: number; excerpt: string }
export interface AiMessage {
  id: number;
  role: "user" | "assistant";
  kind: "question" | "summary";
  content: string;
  citations: AiCitation[];
  createdAt: string;
}
export interface AiConversation {
  conversationId: number | null;
  documentId: number;
  messages: AiMessage[];
}
export interface AiChatResponse {
  conversation: AiConversation;
  updatedDocument: Document | null;
}

export const aiService = {
  models: () => api.get<ModelCatalog>("/api/ai/models"),
  settings: () => api.get<AiSettings>("/api/ai/settings"),
  updateSettings: (body: UpdateAiSettings) => api.put<AiSettings>("/api/ai/settings", body),
  test: () => api.post<{ ok: boolean }>("/api/ai/test"),
  preflight: (documentId: number) =>
    api.get<SummaryPreflight>(`/api/ai/documents/${documentId}/preflight`),
  conversation: (documentId: number) =>
    api.get<AiConversation>(`/api/ai/documents/${documentId}/conversation`),
  ask: (documentId: number, message: string) =>
    api.post<AiChatResponse>(`/api/ai/documents/${documentId}/conversation`, {
      action: "ask",
      message,
    }),
  summarizeInChat: (documentId: number, overwrite = false) =>
    api.post<AiChatResponse>(`/api/ai/documents/${documentId}/conversation`, {
      action: "summarize",
      overwrite,
    }),
  search: (request: string, scope: { libraryId?: number; collectionId?: number } = {}) =>
    api.post<AiSearchInterpretation>("/api/ai/search", { request, ...scope }),
  summarize: (documentId: number, overwrite = false) =>
    api.post<Document>(`/api/documents/${documentId}/summarize`, { overwrite }),
};
