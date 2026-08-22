/**
 * Wire types, mirroring the server's JSON exactly.
 *
 * These are camelCase because the server serialises camelCase. Note what is
 * absent: there is no file path. The client addresses documents by id and gets
 * their bytes from `/api/documents/{id}/file`, so the browser never learns
 * anything about the layout of the library on disk.
 */

export interface Document {
  id: number;
  title: string;
  author: string | null;
  documentType: string;
  fileSize: number | null;
  summary: string | null;
  keywords: string | null;
  doi: string | null;
  isbn: string | null;
  pageCount: number | null;
  year: number | null;
  createdAt: string;
  modifiedAt: string;
  readingProgress: number;
  isFavorite: boolean;
  hasThumbnail: boolean;
}

export interface Library {
  id: number;
  name: string;
  themeColor: string | null;
  icon: string | null;
  iconColor: string | null;
  documentCount: number;
  ownerUsername: string;
  accessRole: "owner" | "editor" | "viewer";
}

export interface LibraryMember {
  userId: number;
  username: string;
  avatarUrl: string | null;
  role: "editor" | "viewer";
}

export interface Collection {
  id: number;
  libraryId: number;
  name: string;
  documentCount: number;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  documentCount: number;
}

export interface Annotation {
  id: number;
  documentId: number;
  annotationType: "highlight" | "note";
  /** Opaque blob. The PDF reader stores a box, the Markdown reader a marker. */
  serializedPosition: string;
  content: string | null;
  color: string | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type SortOrder = "recent" | "added" | "title" | "author" | "year";

export interface DocumentQuery {
  q?: string;
  libraryId?: number;
  collectionId?: number;
  tagId?: number;
  favorite?: boolean;
  sort?: SortOrder;
  limit?: number;
  offset?: number;
}
