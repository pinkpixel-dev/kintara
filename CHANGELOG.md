# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
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

### Fixed
- Resolved thumbnail and cover image loading failure (? icon) in the canvas, details sidebar, and import modal by implementing Tauri `convertFileSrc` and configuring scoped `assetProtocol` in `tauri.conf.json`.
- Fixed typescript compilation error in `DocumentGrid.tsx` caused by a missing `file_path` parameter on document deletion.
- Fixed typescript compilation error in `src/db.ts` by passing the required `canvas` parameter to `page.render()` for newer versions of `pdfjs-dist`.
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
