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

### Fixed
- Fixed PDF extraction crashing due to reference error when parsing titles.
- Fixed `App.css` to properly support manual `[data-theme]` toggles for light/dark mode override.
- Fixed native HTML button rendering on sidebar chevrons to use clean, unstyled icons.
- Improved Help Modal spacing and readability with proper display utilities.
- Changed default app view to `recent` so the dashboard isn't empty upon initial load.
- Adjusted Onboarding flow to reliably trigger the "Name your first Library" prompt upon completion.
- Added layout CSS utility classes to fix scrunching and alignment bugs in UI.
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
