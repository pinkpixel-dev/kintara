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
- Local resource loading is enabled securely via Tauri's `assetProtocol` configured with scopes inside `tauri.conf.json`, allowing the React frontend to render cached PDF and custom cover thumbnails via `convertFileSrc()`.
- Interactive prompts and confirmation boxes (such as highlights, deletion, and canceling imports) are handled elegantly via Tauri's native guest bindings for `@tauri-apps/plugin-dialog`.

## Library & Collection Management
- Libraries and Collections are stored in SQLite with cascade-delete foreign keys.
- Each library supports a custom **Lucide icon** and **icon color** (stored as `icon TEXT` and `icon_color TEXT` columns, added in migration v3).
- A **LibrarySettingsModal** (`src/components/LibrarySettingsModal.tsx`) provides a unified UI for renaming, deleting, and customizing icons/colors for both libraries and collections.
- The sidebar renders the library's chosen icon with the stored color, falling back to `FolderOpen` if none is set.
- Settings and delete controls appear in the main header bar when a library or collection view is active.


## Distribution & Bundling
- **Linux Packages**: Configured via `tauri.conf.json` to generate `.deb`, `.appimage`, and `.rpm` files natively.
- **Windows Executables**: Configured to build standalone `.exe` installers via NSIS.
- **CI/CD Pipeline**: A dedicated GitHub Actions workflow (`build-windows.yml`) runs manually via `workflow_dispatch` on a `windows-latest` VM runner, caching node modules and cargo targets, compiling the codebase, and outputting build artifacts for easy testing.
