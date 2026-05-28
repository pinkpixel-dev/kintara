import Database from "@tauri-apps/plugin-sql";
import { open } from "@tauri-apps/plugin-dialog";
import { basename, extname } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";

let dbInstance: Database | null = null;

export const getDb = async () => {
  if (!dbInstance) {
    dbInstance = await Database.load("sqlite:kintara.db");
  }
  return dbInstance;
};

export interface Document {
  id: number;
  title: string;
  author: string | null;
  file_path: string;
  document_type: string;
  created_date: string;
  modified_date: string;
  reading_progress: number;
  extracted_text: string | null;
  thumbnail_path: string | null;
  summary: string | null;
  keywords: string | null;
  doi: string | null;
  isbn: string | null;
  page_count: number | null;
  year: number | null;
  is_favorite: number;
}

export interface Library {
  id: number;
  name: string;
  theme_color: string | null;
  icon: string | null;
  icon_color: string | null;
}

export interface Collection {
  id: number;
  library_id: number;
  name: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
}

export interface Annotation {
  id: number;
  document_id: number;
  annotation_type: "highlight" | "note";
  serialized_position: string;
  content: string | null;
  color: string | null;
  created_date: string;
}

export const documentService = {
  async getAll(): Promise<Document[]> {
    const db = await getDb();
    return await db.select<Document[]>("SELECT * FROM documents ORDER BY modified_date DESC");
  },

  async getRecent(): Promise<Document[]> {
    const db = await getDb();
    return await db.select<Document[]>("SELECT * FROM documents ORDER BY modified_date DESC LIMIT 10");
  },

  async getFavorites(): Promise<Document[]> {
    const db = await getDb();
    return await db.select<Document[]>("SELECT * FROM documents WHERE is_favorite = 1 ORDER BY modified_date DESC");
  },

  async insert(doc: Omit<Document, "id" | "created_date" | "modified_date" | "reading_progress" | "is_favorite">): Promise<number> {
    const db = await getDb();
    const result = await db.execute(
      `INSERT INTO documents (title, author, file_path, document_type, extracted_text, thumbnail_path, summary, keywords, doi, isbn, page_count, year) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [doc.title, doc.author, doc.file_path, doc.document_type, doc.extracted_text, doc.thumbnail_path, doc.summary, doc.keywords, doc.doi, doc.isbn, doc.page_count, doc.year]
    );
    return result.lastInsertId as number;
  },

  async update(id: number, doc: Partial<Document>): Promise<void> {
    const db = await getDb();
    const setKeys = [];
    const values = [];
    let i = 1;
    for (const [key, value] of Object.entries(doc)) {
      if (key === 'id' || key === 'created_date') continue;
      setKeys.push(`${key} = $${i}`);
      values.push(value);
      i++;
    }
    if (setKeys.length === 0) return;
    setKeys.push(`modified_date = CURRENT_TIMESTAMP`);
    values.push(id);
    await db.execute(`UPDATE documents SET ${setKeys.join(', ')} WHERE id = $${i}`, values);
  },

  async updateProgress(id: number, progress: number): Promise<void> {
    const db = await getDb();
    await db.execute("UPDATE documents SET reading_progress = $1, modified_date = CURRENT_TIMESTAMP WHERE id = $2", [
      progress,
      id,
    ]);
  },

  async updateThumbnail(id: number, thumbnailPath: string | null): Promise<void> {
    const db = await getDb();
    await db.execute("UPDATE documents SET thumbnail_path = $1, modified_date = CURRENT_TIMESTAMP WHERE id = $2", [thumbnailPath, id]);
  },

  async toggleFavorite(id: number, currentStatus: number): Promise<void> {
    const db = await getDb();
    await db.execute("UPDATE documents SET is_favorite = $1, modified_date = CURRENT_TIMESTAMP WHERE id = $2", [
      currentStatus === 1 ? 0 : 1,
      id
    ]);
  },

  async search(query: string): Promise<Document[]> {
    const db = await getDb();
    const searchTerm = `%${query}%`;
    return await db.select<Document[]>(
      "SELECT * FROM documents WHERE title LIKE $1 OR author LIKE $2 OR summary LIKE $3 OR keywords LIKE $4 ORDER BY modified_date DESC",
      [searchTerm, searchTerm, searchTerm, searchTerm]
    );
  },

  async delete(id: number, filePath: string): Promise<void> {
    const db = await getDb();
    await db.execute("DELETE FROM documents WHERE id = $1", [id]);
    try {
      await invoke("delete_document_file", { filePath });
    } catch (err) {
      console.error("Failed to delete file from filesystem", err);
    }
  },

  async importDocument(): Promise<Document | null> {
    const selected = await open({
      multiple: false,
      filters: [{
        name: 'Documents',
        extensions: ['pdf', 'md', 'txt']
      }]
    });

    if (!selected) return null;
    
    const sourcePath = selected as string;
    if (!sourcePath) return null;

    const baseName = await basename(sourcePath);
    const extension = await extname(sourcePath);
    const docType = extension.toLowerCase();
    
    let destPath: string;
    try {
      destPath = await invoke<string>("copy_file_to_library", { 
        sourcePath, 
        filename: baseName 
      });
    } catch (err) {
      alert(`Rust copy failed: ${JSON.stringify(err)}`);
      console.error("Rust failed to copy file", err);
      return null;
    }

    let pageCount = null;
    let author = null;
    let keywords = null;
    let extractedTitle = baseName.replace('.' + extension, '');
    let year = null;
    let thumbnailPath: string | null = null;

    if (docType === 'pdf') {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
        const data = await invoke<number[]>("read_file_from_library", { filePath: destPath });
        const fileData = new Uint8Array(data);
        const loadingTask = pdfjsLib.getDocument({ data: fileData });
        const doc = await loadingTask.promise;
        pageCount = doc.numPages;

        try {
          const page = await doc.getPage(1);
          const viewport = page.getViewport({ scale: 1.0 });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (ctx) {
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: ctx, viewport: viewport, canvas: canvas }).promise;
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const thumbFilename = `thumb_${Date.now()}.jpg`;
            
            const { BaseDirectory, writeFile } = await import('@tauri-apps/plugin-fs');
            await writeFile(`library/thumbnails/${thumbFilename}`, uint8Array, { baseDir: BaseDirectory.AppLocalData });
            
            const { appDataDir, join } = await import('@tauri-apps/api/path');
            const dataDir = await appDataDir();
            thumbnailPath = await join(dataDir, 'library', 'thumbnails', thumbFilename);
          }
        } catch (e) {
          console.error("Failed to generate PDF thumbnail", e);
        }

        const metadataData = await doc.getMetadata();
        const info = metadataData.info as any;
        if (info) {
          if (info.Title) extractedTitle = info.Title;
          if (info.Author) author = info.Author;
          if (info.Keywords) keywords = info.Keywords;
          if (info.CreationDate) {
            // PDF date format: D:YYYYMMDDHHmmSSOHH'mm'
            const match = info.CreationDate.match(/^D:(\d{4})/);
            if (match) year = parseInt(match[1], 10);
          }
        }
      } catch (e) {
        console.error("Failed to extract PDF metadata", e);
      }
    }
    
    try {
      const docId = await documentService.insert({
        title: extractedTitle,
        author: author,
        file_path: destPath,
        document_type: docType,
        extracted_text: null,
        thumbnail_path: thumbnailPath,
        summary: null,
        keywords: keywords,
        doi: null,
        isbn: null,
        page_count: pageCount,
        year: year
      });

      const db = await getDb();
      const newDoc = await db.select<Document[]>("SELECT * FROM documents WHERE id = $1", [docId]);
      return newDoc[0];
    } catch (err) {
      alert(`DB Insert failed: ${JSON.stringify(err)}`);
      throw err;
    }
  }
};

export const libraryService = {
  async getAll(): Promise<Library[]> {
    const db = await getDb();
    return await db.select<Library[]>("SELECT * FROM libraries");
  },

  async create(name: string, themeColor: string | null = null): Promise<number> {
    const db = await getDb();
    const result = await db.execute("INSERT INTO libraries (name, theme_color) VALUES ($1, $2)", [name, themeColor]);
    return result.lastInsertId as number;
  },

  async rename(id: number, name: string): Promise<void> {
    const db = await getDb();
    await db.execute("UPDATE libraries SET name = $1 WHERE id = $2", [name, id]);
  },

  async update(id: number, fields: { name?: string; icon?: string | null; icon_color?: string | null }): Promise<void> {
    const db = await getDb();
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (fields.name !== undefined) { sets.push(`name = $${i++}`); vals.push(fields.name); }
    if (fields.icon !== undefined) { sets.push(`icon = $${i++}`); vals.push(fields.icon); }
    if (fields.icon_color !== undefined) { sets.push(`icon_color = $${i++}`); vals.push(fields.icon_color); }
    if (sets.length === 0) return;
    vals.push(id);
    await db.execute(`UPDATE libraries SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  },

  async delete(id: number): Promise<void> {
    const db = await getDb();
    await db.execute("DELETE FROM libraries WHERE id = $1", [id]);
  },

  async getDocuments(libraryId: number): Promise<Document[]> {
    const db = await getDb();
    return await db.select<Document[]>(
      `SELECT d.* FROM documents d
       JOIN library_documents ld ON d.id = ld.document_id
       WHERE ld.library_id = $1
       ORDER BY d.modified_date DESC`,
      [libraryId]
    );
  },

  async addDocument(libraryId: number, documentId: number): Promise<void> {
    const db = await getDb();
    await db.execute("INSERT OR IGNORE INTO library_documents (library_id, document_id) VALUES ($1, $2)", [libraryId, documentId]);
  }
};

export const collectionService = {
  async getAllForLibrary(libraryId: number): Promise<Collection[]> {
    const db = await getDb();
    return await db.select<Collection[]>("SELECT * FROM collections WHERE library_id = $1", [libraryId]);
  },

  async getById(id: number): Promise<Collection | null> {
    const db = await getDb();
    const rows = await db.select<Collection[]>("SELECT * FROM collections WHERE id = $1", [id]);
    return rows[0] ?? null;
  },

  async create(libraryId: number, name: string): Promise<number> {
    const db = await getDb();
    const result = await db.execute("INSERT INTO collections (library_id, name) VALUES ($1, $2)", [libraryId, name]);
    return result.lastInsertId as number;
  },

  async rename(id: number, name: string): Promise<void> {
    const db = await getDb();
    await db.execute("UPDATE collections SET name = $1 WHERE id = $2", [name, id]);
  },

  async delete(id: number): Promise<void> {
    const db = await getDb();
    await db.execute("DELETE FROM collections WHERE id = $1", [id]);
  },

  async getDocuments(collectionId: number): Promise<Document[]> {
    const db = await getDb();
    return await db.select<Document[]>(
      `SELECT d.* FROM documents d
       JOIN document_collections dc ON d.id = dc.document_id
       WHERE dc.collection_id = $1
       ORDER BY d.modified_date DESC`,
      [collectionId]
    );
  },

  async addDocument(collectionId: number, documentId: number): Promise<void> {
    const db = await getDb();
    await db.execute("INSERT OR IGNORE INTO document_collections (collection_id, document_id) VALUES ($1, $2)", [collectionId, documentId]);
  }
};

export const tagService = {
  async getAll(): Promise<Tag[]> {
    const db = await getDb();
    return await db.select<Tag[]>("SELECT * FROM tags");
  },

  async getForDocument(documentId: number): Promise<Tag[]> {
    const db = await getDb();
    return await db.select<Tag[]>(
      `SELECT t.* FROM tags t
       JOIN document_tags dt ON t.id = dt.tag_id
       WHERE dt.document_id = $1`,
      [documentId]
    );
  },

  async create(name: string, color: string | null = null): Promise<number> {
    const db = await getDb();
    const result = await db.execute("INSERT INTO tags (name, color) VALUES ($1, $2)", [name, color]);
    return result.lastInsertId as number;
  },

  async addTagToDocument(documentId: number, tagId: number): Promise<void> {
    const db = await getDb();
    await db.execute("INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES ($1, $2)", [documentId, tagId]);
  },

  async removeTagFromDocument(documentId: number, tagId: number): Promise<void> {
    const db = await getDb();
    await db.execute("DELETE FROM document_tags WHERE document_id = $1 AND tag_id = $2", [documentId, tagId]);
  }
};

export const annotationService = {
  async getByDocument(documentId: number): Promise<Annotation[]> {
    const db = await getDb();
    return await db.select<Annotation[]>("SELECT * FROM annotations WHERE document_id = $1", [documentId]);
  },

  async create(ann: Omit<Annotation, "id" | "created_date">): Promise<number> {
    const db = await getDb();
    const result = await db.execute(
      `INSERT INTO annotations (document_id, annotation_type, serialized_position, content, color)
       VALUES ($1, $2, $3, $4, $5)`,
      [ann.document_id, ann.annotation_type, ann.serialized_position, ann.content, ann.color]
    );
    return result.lastInsertId as number;
  },

  async delete(id: number): Promise<void> {
    const db = await getDb();
    await db.execute("DELETE FROM annotations WHERE id = $1", [id]);
  }
};
