# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
### Added
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
