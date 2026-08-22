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
  openaiImage: string[];
  googleImage: string[];
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
  openaiImageModel: string;
  googleImageModel: string;
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
  openaiImageModel: string;
  googleImageModel: string;
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
  canSuggestMetadata: boolean;
  canGenerateCover: boolean;
  imageModel: string;
  hasCover: boolean;
  /** True when this provider's image endpoint cannot disable retention. */
  imageStoredByProvider: boolean;
}

export interface MetadataSuggestionCandidate {
  title: string | null;
  author: string | null;
  summary: string | null;
  keywords: string | null;
  doi: string | null;
  isbn: string | null;
  year: number | null;
  provider: AiProvider;
  model: string;
}

export interface CoverCandidate {
  imageBase64: string;
  mimeType: string;
  provider: AiProvider;
  model: string;
  storedByProvider: boolean;
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

/**
 * A passage the model found in a document, verified server-side to occur
 * verbatim on the page it names. The exact wording is what lets the reader
 * place a highlight over it.
 */
export interface AiPassage {
  page: number;
  excerpt: string;
  note: string;
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
  clearConversation: (documentId: number) =>
    api.delete<void>(`/api/ai/documents/${documentId}/conversation`),
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
  suggestMetadata: (documentId: number, expectedProvider: AiProvider, expectedModel: string) =>
    api.post<MetadataSuggestionCandidate>(`/api/ai/documents/${documentId}/metadata`, {
      expectedProvider,
      expectedModel,
    }),
  generateCover: (documentId: number, customPrompt?: string) =>
    api.post<CoverCandidate>(`/api/ai/documents/${documentId}/cover`,
      customPrompt === undefined ? {} : { customPrompt }),
  find: (documentId: number, request: string) =>
    api.post<{ passages: AiPassage[] }>(`/api/ai/documents/${documentId}/find`, { request }),
  search: (request: string, scope: { libraryId?: number; collectionId?: number } = {}) =>
    api.post<AiSearchInterpretation>("/api/ai/search", { request, ...scope }),
  summarize: (documentId: number, overwrite = false) =>
    api.post<Document>(`/api/documents/${documentId}/summarize`, { overwrite }),
};
