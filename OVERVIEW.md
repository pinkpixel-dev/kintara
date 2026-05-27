# Kintara Technical Overview

## Architecture
- **Frontend**: React, Vite, TypeScript
- **Styling**: Vanilla CSS (monochromatic dark/light modes with purple `#410186` accents)
- **Backend/Desktop Layer**: Tauri (Rust)
- **Database**: SQLite (via Tauri Rust commands)

## Design System
The UI relies on a flexible 3-pane layout: Sidebar (Libraries/Collections), Main View (Grid or Reader), and Details Sidebar. The styling uses native CSS variables to ensure highly performant and flexible theming.

## Data Flow
- Frontend interacts with Rust backend via Tauri IPC (`invoke` commands).
- Backend manages the managed library folder and SQLite instance for fast metadata retrieval and full-text search (FTS5).
