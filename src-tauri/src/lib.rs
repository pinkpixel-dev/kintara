use std::fs;
use tauri::Manager;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn copy_file_to_library(app: tauri::AppHandle, source_path: String, filename: String) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dest_path = app_data_dir.join("library").join("documents").join(&filename);
    std::fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
fn copy_thumbnail_to_library(app: tauri::AppHandle, source_path: String, filename: String) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dest_path = app_data_dir.join("library").join("thumbnails").join(&filename);
    std::fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_file_from_library(file_path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_document_file(file_path: String) -> Result<(), String> {
    if std::path::Path::new(&file_path).exists() {
        std::fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: "
                CREATE TABLE IF NOT EXISTS documents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    author TEXT,
                    file_path TEXT NOT NULL UNIQUE,
                    document_type TEXT NOT NULL,
                    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                    modified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                    reading_progress REAL DEFAULT 0,
                    extracted_text TEXT,
                    thumbnail_path TEXT,
                    summary TEXT,
                    keywords TEXT,
                    doi TEXT,
                    isbn TEXT,
                    page_count INTEGER,
                    year INTEGER
                );
                
                CREATE TABLE IF NOT EXISTS tags (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    color TEXT
                );
                
                CREATE TABLE IF NOT EXISTS document_tags (
                    document_id INTEGER,
                    tag_id INTEGER,
                    PRIMARY KEY (document_id, tag_id),
                    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
                    FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS libraries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    theme_color TEXT
                );
                
                CREATE TABLE IF NOT EXISTS collections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    library_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    FOREIGN KEY(library_id) REFERENCES libraries(id) ON DELETE CASCADE,
                    UNIQUE(library_id, name)
                );
                
                CREATE TABLE IF NOT EXISTS document_collections (
                    document_id INTEGER,
                    collection_id INTEGER,
                    PRIMARY KEY (document_id, collection_id),
                    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
                    FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS library_documents (
                    library_id INTEGER,
                    document_id INTEGER,
                    PRIMARY KEY (library_id, document_id),
                    FOREIGN KEY(library_id) REFERENCES libraries(id) ON DELETE CASCADE,
                    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS annotations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    document_id INTEGER NOT NULL,
                    annotation_type TEXT NOT NULL,
                    serialized_position TEXT NOT NULL,
                    content TEXT,
                    color TEXT,
                    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_is_favorite",
            sql: "ALTER TABLE documents ADD COLUMN is_favorite INTEGER DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_library_icon_fields",
            sql: "ALTER TABLE libraries ADD COLUMN icon TEXT; ALTER TABLE libraries ADD COLUMN icon_color TEXT;",
            kind: MigrationKind::Up,
        }
    ];

    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            let library_dir = app_data_dir.join("library");
            let docs_dir = library_dir.join("documents");
            let thumbs_dir = library_dir.join("thumbnails");

            if !library_dir.exists() {
                fs::create_dir_all(&library_dir).expect("Failed to create library dir");
            }
            if !docs_dir.exists() {
                fs::create_dir_all(&docs_dir).expect("Failed to create documents dir");
            }
            if !thumbs_dir.exists() {
                fs::create_dir_all(&thumbs_dir).expect("Failed to create thumbnails dir");
            }

            Ok(())
        })
        .plugin(tauri_plugin_os::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:kintara.db", migrations)
                .build()
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, copy_file_to_library, copy_thumbnail_to_library, read_file_from_library, delete_document_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
