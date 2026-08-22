import { api } from "./client";
import type { Document } from "./types";

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
}

export const aiService = {
  models: () => api.get<ModelCatalog>("/api/ai/models"),
  settings: () => api.get<AiSettings>("/api/ai/settings"),
  updateSettings: (body: UpdateAiSettings) => api.put<AiSettings>("/api/ai/settings", body),
  test: () => api.post<{ ok: boolean }>("/api/ai/test"),
  preflight: (documentId: number) =>
    api.get<SummaryPreflight>(`/api/ai/documents/${documentId}/preflight`),
  summarize: (documentId: number, overwrite = false) =>
    api.post<Document>(`/api/documents/${documentId}/summarize`, { overwrite }),
};
