import Database from "@tauri-apps/plugin-sql";
import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, exists } from "@tauri-apps/plugin-fs";
import { appDataDir, join, basename, extname } from "@tauri-apps/api/path";

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
    
    const appDir = await appDataDir();
    const destPath = await join(appDir, "library", "documents", baseName);
    
    // Basic avoid overwrite
    const fileExists = await exists(destPath);
    if (fileExists) {
      console.warn("File already exists in library");
      // For MVP, just return the existing DB entry if we can find it
      const db = await getDb();
      const existing = await db.select<Document[]>("SELECT * FROM documents WHERE file_path = $1", [destPath]);
      if (existing.length > 0) return existing[0];
    } else {
      await copyFile(sourcePath, destPath);
    }

    const title = baseName.replace(`.${extension}`, '');
    
    const docId = await this.insert({
      title,
      author: null,
      file_path: destPath,
      document_type: docType,
      extracted_text: null
    });

    const db = await getDb();
    const newDoc = await db.select<Document[]>("SELECT * FROM documents WHERE id = $1", [docId]);
    return newDoc[0];
  }
};
