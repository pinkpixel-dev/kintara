import { api, queryString } from "./client";
import type { Annotation, Document, DocumentQuery, Page, Tag } from "./types";

/** URLs the browser loads directly, rather than through fetch. */
export const documentUrls = {
  /** Streamed with Range support, which is what lets pdf.js load in chunks. */
  file: (id: number) => `/api/documents/${id}/file`,
  thumbnail: (id: number) => `/api/documents/${id}/thumbnail`,
  download: (id: number) => `/api/documents/${id}/download`,
};

export const documentService = {
  list(query: DocumentQuery = {}): Promise<Page<Document>> {
    return api.get(`/api/documents${queryString({ ...query })}`);
  },

  get(id: number): Promise<Document> {
    return api.get(`/api/documents/${id}`);
  },

  /**
   * Uploads a file, optionally filing it on arrival.
   *
   * The server extracts metadata and renders a cover, so the returned document
   * already has its real title rather than a placeholder.
   */
  upload(file: File, placement: { libraryId?: number; collectionId?: number } = {}): Promise<Document> {
    const form = new FormData();
    form.append("file", file);
    if (placement.libraryId !== undefined) form.append("libraryId", String(placement.libraryId));
    if (placement.collectionId !== undefined) {
      form.append("collectionId", String(placement.collectionId));
    }
    return api.upload("/api/documents", form);
  },

  /**
   * Edits metadata. Passing null for a field clears it; omitting it leaves it
   * alone — the server distinguishes the two.
   */
  update(
    id: number,
    fields: Partial<
      Pick<Document, "title" | "author" | "summary" | "keywords" | "doi" | "isbn" | "year">
    >,
  ): Promise<void> {
    return api.patch(`/api/documents/${id}`, fields);
  },

  /** Removes the document, its file, and its cover. Confirm before calling. */
  remove(id: number): Promise<void> {
    return api.delete(`/api/documents/${id}`);
  },

  setProgress(id: number, readingProgress: number): Promise<void> {
    return api.put(`/api/documents/${id}/progress`, { readingProgress });
  },

  setFavorite(id: number, isFavorite: boolean): Promise<void> {
    return api.put(`/api/documents/${id}/favorite`, { isFavorite });
  },

  uploadCover(id: number, file: File): Promise<void> {
    const form = new FormData();
    form.append("file", file);
    return api.upload(`/api/documents/${id}/cover`, form);
  },

  tags(id: number): Promise<Tag[]> {
    return api.get(`/api/documents/${id}/tags`);
  },

  addTag(id: number, tagId: number): Promise<void> {
    return api.post(`/api/documents/${id}/tags/${tagId}`);
  },

  removeTag(id: number, tagId: number): Promise<void> {
    return api.delete(`/api/documents/${id}/tags/${tagId}`);
  },

  annotations(id: number): Promise<Annotation[]> {
    return api.get(`/api/documents/${id}/annotations`);
  },

  /** Fetches a text document's contents for the Markdown reader. */
  async text(id: number): Promise<string> {
    const response = await fetch(documentUrls.file(id));
    if (!response.ok) throw new Error(`Failed to load document (${response.status})`);
    return response.text();
  },
};
