import Database from "@tauri-apps/plugin-sql";
import { open } from "@tauri-apps/plugin-dialog";
import { appDataDir, join, basename, extname } from "@tauri-apps/api/path";
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
}

export interface Workspace {
  id: number;
  name: string;
  theme_color: string | null;
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

  async insert(doc: Omit<Document, "id" | "created_date" | "modified_date" | "reading_progress">): Promise<number> {
    const db = await getDb();
    const result = await db.execute(
      `INSERT INTO documents (title, author, file_path, document_type, extracted_text) 
       VALUES ($1, $2, $3, $4, $5)`,
      [doc.title, doc.author, doc.file_path, doc.document_type, doc.extracted_text]
    );
    return result.lastInsertId as number;
  },

  async updateProgress(id: number, progress: number): Promise<void> {
    const db = await getDb();
    await db.execute("UPDATE documents SET reading_progress = $1, modified_date = CURRENT_TIMESTAMP WHERE id = $2", [
      progress,
      id,
    ]);
  },

  async search(query: string): Promise<Document[]> {
    const db = await getDb();
    const searchTerm = `%${query}%`;
    return await db.select<Document[]>(
      "SELECT * FROM documents WHERE title LIKE $1 OR author LIKE $2 ORDER BY modified_date DESC",
      [searchTerm, searchTerm]
    );
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
    
    // Tauri v2 dialog returns { path, name } or just the path string
    // Let's handle both string and object returns just in case
    const sourcePath = typeof selected === 'string' ? selected : selected.path;
    if (!sourcePath) return null;

    const baseName = await basename(sourcePath);
    const extension = await extname(sourcePath);
    
    // Determine type
    const docType = extension.toLowerCase();
    
    // Bypass Tauri FS plugin restrictions by invoking Rust command directly
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

    const title = baseName.replace(`.${extension}`, '');
    
    try {
      const docId = await documentService.insert({
        title,
        author: null,
        file_path: destPath,
        document_type: docType,
        extracted_text: null
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

export const workspaceService = {
  async getAll(): Promise<Workspace[]> {
    const db = await getDb();
    return await db.select<Workspace[]>("SELECT * FROM workspaces");
  },

  async create(name: string, themeColor: string | null = null): Promise<number> {
    const db = await getDb();
    const result = await db.execute("INSERT INTO workspaces (name, theme_color) VALUES ($1, $2)", [name, themeColor]);
    return result.lastInsertId as number;
  },

  async getDocuments(workspaceId: number): Promise<Document[]> {
    const db = await getDb();
    return await db.select<Document[]>(
      `SELECT d.* FROM documents d
       JOIN workspace_documents wd ON d.id = wd.document_id
       WHERE wd.workspace_id = $1
       ORDER BY d.modified_date DESC`,
      [workspaceId]
    );
  },

  async addDocument(workspaceId: number, documentId: number): Promise<void> {
    const db = await getDb();
    await db.execute("INSERT OR IGNORE INTO workspace_documents (workspace_id, document_id) VALUES ($1, $2)", [workspaceId, documentId]);
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
  }
};
