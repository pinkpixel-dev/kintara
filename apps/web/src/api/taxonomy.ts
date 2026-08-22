import { api, queryString } from "./client";
import type { Annotation, Collection, Library, LibraryMember, Tag } from "./types";

export const libraryService = {
  list(): Promise<Library[]> {
    return api.get("/api/libraries");
  },

  create(fields: {
    name: string;
    icon?: string | null;
    iconColor?: string | null;
    themeColor?: string | null;
  }): Promise<Library> {
    return api.post("/api/libraries", fields);
  },

  update(
    id: number,
    fields: {
      name?: string;
      icon?: string | null;
      iconColor?: string | null;
      themeColor?: string | null;
    },
  ): Promise<Library> {
    return api.patch(`/api/libraries/${id}`, fields);
  },

  /** Removes the library and its collections. Documents are left alone. */
  remove(id: number): Promise<void> {
    return api.delete(`/api/libraries/${id}`);
  },

  addDocument(id: number, documentId: number): Promise<void> {
    return api.post(`/api/libraries/${id}/documents/${documentId}`);
  },

  removeDocument(id: number, documentId: number): Promise<void> {
    return api.delete(`/api/libraries/${id}/documents/${documentId}`);
  },

  members(id: number): Promise<LibraryMember[]> {
    return api.get(`/api/libraries/${id}/members`);
  },

  share(id: number, username: string, role: "viewer" | "editor"): Promise<LibraryMember> {
    return api.post(`/api/libraries/${id}/members`, { username, role });
  },

  updateMember(id: number, userId: number, role: "viewer" | "editor"): Promise<LibraryMember> {
    return api.patch(`/api/libraries/${id}/members/${userId}`, { role });
  },

  removeMember(id: number, userId: number): Promise<void> {
    return api.delete(`/api/libraries/${id}/members/${userId}`);
  },
};

export const collectionService = {
  list(libraryId?: number): Promise<Collection[]> {
    return api.get(`/api/collections${queryString({ libraryId })}`);
  },

  async get(id: number): Promise<Collection | null> {
    const all = await collectionService.list();
    return all.find((collection) => collection.id === id) ?? null;
  },

  create(libraryId: number, name: string): Promise<Collection> {
    return api.post("/api/collections", { libraryId, name });
  },

  rename(id: number, name: string): Promise<Collection> {
    return api.patch(`/api/collections/${id}`, { name });
  },

  remove(id: number): Promise<void> {
    return api.delete(`/api/collections/${id}`);
  },

  addDocument(id: number, documentId: number): Promise<void> {
    return api.post(`/api/collections/${id}/documents/${documentId}`);
  },

  removeDocument(id: number, documentId: number): Promise<void> {
    return api.delete(`/api/collections/${id}/documents/${documentId}`);
  },
};

export const tagService = {
  list(): Promise<Tag[]> {
    return api.get("/api/tags");
  },

  /**
   * Creates a tag, or returns the existing one with that name. The server
   * handles the dedupe, so callers do not need to look first.
   */
  create(name: string, color?: string | null): Promise<Tag> {
    return api.post("/api/tags", { name, color });
  },

  remove(id: number): Promise<void> {
    return api.delete(`/api/tags/${id}`);
  },
};

export const annotationService = {
  create(fields: {
    documentId: number;
    annotationType: "highlight" | "note";
    serializedPosition: string;
    content?: string | null;
    color?: string | null;
  }): Promise<Annotation> {
    return api.post("/api/annotations", fields);
  },

  remove(id: number): Promise<void> {
    return api.delete(`/api/annotations/${id}`);
  },
};
