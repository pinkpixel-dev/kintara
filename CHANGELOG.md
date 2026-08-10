# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
The server-first rewrite is in progress. Kintara is becoming a self-hosted document
library that runs in Docker on a NAS, served as an installable PWA, with a Rust/Axum
backend replacing the Tauri IPC layer. See `DOCS/OVERVIEW.md` for the target architecture.
The frontend still talks to Tauri; porting it to the API is the next step.

## [0.7.0] - 2026-08-10
### Added
- **`kintara-server`** — new Rust/Axum backend in `apps/server/`. Runs, serves the built
  frontend, applies its own migrations, and answers `GET /api/health` with a live document
  count (which doubles as a container healthcheck, since it proves the database is reachable).
- **Server schema (migration 0001).** Ported from the desktop migrations with four
  deliberate changes for multi-user, containerised operation:
  - `documents.relative_path` replaces the desktop's absolute `file_path`, so the library
    volume can be remounted anywhere without invalidating every row.
  - `reading_progress` and `is_favorite` move off `documents` into `user_document_state`,
    keyed by `(user_id, document_id)`. `annotations` gains a `user_id`.
  - `documents` gains `file_hash`, `file_size`, and `indexed_at` for the incoming scanner.
  - Search is backed by an FTS5 external-content table with sync triggers, replacing the
    desktop's `LIKE '%term%'` full scan.
- **Configuration via environment** — `KINTARA_LIBRARY_DIR`, `KINTARA_DATA_DIR`,
  `KINTARA_WEB_DIR`, `KINTARA_BIND`, `KINTARA_LOG`. Defaults are relative so `cargo run`
  works with no setup; the container overrides them with absolute paths. The database
  deliberately lives under the data directory, never the library share, because SQLite
  over SMB/NFS corrupts.
- **Graceful SIGTERM shutdown**, so `docker stop` does not wait out the kill timeout.
- **12 integration tests** covering migrations, WAL and foreign-key enforcement on pool
  connections, cascade deletes, the `annotation_type` CHECK constraint, `relative_path`
  uniqueness, FTS insert/update/delete sync, and HTTP routing. They run against real
  SQLite files and the real router — no mocks.

### Fixed
- Unmatched `/api/*` routes returned the SPA `index.html` with a 200 instead of a JSON
  404, which would have made every client-side fetch bug look like an HTML-parsed-as-JSON
  error. Caught by the test written for it.

### Notes
- `apps/desktop/` stays pinned at 0.6.2. It is frozen, so its version reflects where it
  froze rather than tracking the server.

## [0.6.2] - 2026-08-10
### Changed
- **Repository restructured as a monorepo** in preparation for the server-first rewrite.
  `src/` moved to `apps/web/src/`, `src-tauri/` moved to `apps/desktop/`, and new empty
  `apps/server/` and `docker/` directories were added for the incoming Rust backend.
- Frontend is now an npm workspace (`@kintara/web`). The root `package.json` is the
  version source of truth and delegates `dev`, `build`, and `preview` to the workspace.
- Documentation moved into `DOCS/` (`OVERVIEW.md`, `ROADMAP.md`, `to-do.md`).
  `README.md`, `CHANGELOG.md`, and `LICENSE` remain at the repository root.
- Brand source images (`icon.png`, `logo.png`) moved to `assets/` so they are not
  copied into the web bundle.
- **Version fields reconciled.** `package.json`, `tauri.conf.json`, and `Cargo.toml`
  had drifted to `0.1.0` while the changelog had advanced to `0.6.1`. All now read `0.6.2`.
- Desktop crate renamed from `tauri-app` to `kintara-desktop`, with real author and
  description metadata.

### Removed
- `.github/workflows/build-windows.yml` — it built the now-frozen desktop shell. A
  multi-arch Docker workflow replaces it once the server exists.

### Notes
- No application logic changed in this release. The frontend still talks to Tauri and
  still builds; `apps/desktop/` is retained but frozen and not wired into any build.

## [0.6.1] - 2026-05-27
### Added
- **Highlight Color Picker** — new Highlights section in Settings lets users choose from 8 preset colors (Purple, Yellow, Green, Blue, Pink, Orange, Teal, Red) for text and PDF highlights.
- **Remove Highlights** — clicking any highlighted text in the Markdown reader removes that highlight immediately. Clicking a PDF highlight box also removes it (with fade hover feedback).
- `annotationService.delete(id)` method added to the DB service layer.

### Changed
- **Removed highlight confirmation dialog** — selecting text no longer shows a native `ask()` popup; highlights are applied instantly on mouse-up for a much smoother reading experience.
- Highlight color is now stored as a CSS custom property (`--highlight-color`) on `<html>` and applied on both app startup and whenever settings change, so both readers always use the user's chosen color.
- Markdown reader hint text updated to: "Select text to highlight · Click a highlight to remove it".
- PDF highlights now dim on hover to signal they are clickable/removable.

## [0.6.0] - 2026-05-27
### Added
- **Library Settings Modal** — clicking the ⚙ icon in the header when a library or collection is active opens a dedicated settings panel for renaming, deleting, and (for libraries) choosing a custom icon and icon color.
- **Library Icon Customization** — libraries can now have a custom Lucide icon (29 options: BookOpen, Palette, Code, Music, Film, etc.) and a custom icon color (15 presets + custom hex picker). The icon is displayed in the sidebar next to the library name.
- **Library & Collection Delete** — integrated delete with a two-step confirmation inside the settings modal. Deleting a library navigates back to Recent; documents are preserved but removed from the library.
- **Collection Rename** — collections can now be renamed via the same settings modal flow.
- **SQLite Migration v3** — adds `icon TEXT` and `icon_color TEXT` columns to the `libraries` table via an incremental Tauri migration.
- **Sidebar event listener** — sidebar now responds to a `reload-sidebar` custom event so library changes from anywhere in the app are reflected immediately.

### Changed
- Removed the inline Edit (pencil) icon from library rows in the sidebar — editing is now handled via the cleaner settings modal, reducing sidebar clutter especially at larger font sizes.
- Widened sidebar from 260 px to 280 px to better accommodate longer library names at larger text sizes.
- Made the "Kintara" logo text bolder (`fontWeight: 800`) and slightly larger (`1.25rem`) in the sidebar header.
- Logo image in sidebar header slightly enlarged from `w-12 h-12` to 52 px for improved visual presence.

### Added
- Implemented nested Collections under Libraries in the sidebar.
- Added a Document Grid view for library/collection browsing.
- Extracted PDF metadata (Title, Author, Keywords, Year) automatically via pdfjs-dist on import.
- Built an editable "Details" sidebar for managing document metadata, tags, and thumbnails.
- Created persistent Settings page (theme, typography) using `settings.json` in the app data directory.
- Added global keyboard shortcuts for navigation and actions.
- Introduced an interactive Help & Shortcuts modal and Onboarding overlay.
- Added the ability to completely delete imported documents.
- Added UI prompt system for creating and renaming libraries and collections.
- Added `remark-gfm` to support Markdown tables and GitHub Flavored Markdown in the reader.
- Added a Trash icon overlay on document thumbnails for quick deletion.
- Integrated Tauri's native `@tauri-apps/plugin-dialog` `ask` dialog API to replace basic web browser alert confirmations for deleting, highlighting, and canceling imports, creating a premium desktop-grade feel.
- Standardized document cover/thumbnail aspect ratio to consistent 3:4 (portrait) across the main grid and details sidebar.
- Configured Tauri bundler targets explicitly for `.deb`, `.appimage`, `.rpm`, and `.nsis` builds along with premium app-level metadata and descriptions in `tauri.conf.json`.
- Added manual GitHub Actions workflow (`build-windows.yml`) using `workflow_dispatch` to compile the Windows `.exe` installer and compile binary artifacts.
- Styled Kintara logo text in the sidebar to persistently render with the **Bellota** font family at a premium medium weight, isolated from general typography choices.
- Expanded typography settings in the Settings page to include Outfit, Livvic, Life Savers, M PLUS U, Bellota, and Elsie fonts.

### Fixed
- Resolved thumbnail and cover image loading failure (? icon) in the canvas, details sidebar, and import modal by implementing Tauri `convertFileSrc` and configuring scoped `assetProtocol` in `tauri.conf.json`.
- Fixed typescript compilation error in `DocumentGrid.tsx` caused by a missing `file_path` parameter on document deletion.
- Fixed typescript compilation error in `src/db.ts` by passing the required `canvas` parameter to `page.render()` for newer versions of `pdfjs-dist`.
- Fixed Tauri bundle build failure caused by invalid category value in `tauri.conf.json` by removing the optional category property.
- Removed redundant and accidental-click-prone delete button from DetailsSidebar header, centralizing delete action to the quick-action grid hover overlay.
- Fixed PDF extraction crashing due to reference error when parsing titles.
- Fixed `App.css` to properly support manual `[data-theme]` toggles for light/dark mode override.
- Fixed native HTML button rendering on sidebar chevrons to use clean, unstyled icons.
- Improved Help Modal spacing and readability with proper display utilities.
- Changed default app view to `recent` so the dashboard isn't empty upon initial load.
- Adjusted Onboarding flow to reliably trigger the "Name your first Library" prompt upon completion.
- Added layout CSS utility classes to fix scrunching and alignment bugs in UI.
- Fixed sidebar active selection styling to properly contrast in Light and Dark modes.
- Fixed settings logic so Reader Themes apply correctly and distinctly from UI Themes.
- Fixed PDF reader background to respond to the dark/light Reader Theme correctly.
- Fixed thumbnail Star icon to align to the top right and persistently display yellow when favorited.
- Fixed Details Sidebar to fallback to the currently active reading document if no specific thumbnail was clicked.
- Initialized Tauri + React + Vite + TypeScript project.
- Generated application icons from `icon.png`.
- Created initial documentation (`README.md`, `OVERVIEW.md`, `CHANGELOG.md`, `LICENSE`).

### Fixed
- Fixed missing app name by restoring "Kintara" to the sidebar header and separating the workspace selector.
- Reverted theme accent to `#410186` per request and improved UI typography.
- Updated sidebar logo to use `logo.png` instead of the icon.
- Fixed split view layout allowing both sides to scale equally by removing absolute positioning and standardizing DOM structures for panels.
- Relocated split view selector to main header to eliminate asymmetrical padding on the right panel.
- Fixed unreadable white-on-white text in select dropdowns by setting `color-scheme` property for native inputs and standardizing background colors globally.
- Constrained the maximum height of PDF pages to fit entirely within the viewport without clipping.
