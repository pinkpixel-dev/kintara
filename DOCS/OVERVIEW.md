# Kintara Technical Overview

## Direction
Kintara is mid-transition from a Tauri desktop reader to a **server-first, self-hosted
document library** that runs in Docker on a NAS and is served as an installable PWA.

- A single Rust/Axum binary will serve both the JSON API and the built frontend.
- The frontend will speak only HTTP, so there is no dual data layer to maintain.
- `apps/desktop/` is **frozen**. It still contains the working Tauri shell and is kept
  so the option of a local sidecar build stays open, but it is not part of any build.

Everything below the Repository Structure section describes the current desktop
implementation and remains accurate until the port replaces it.

## Repository Structure
```
apps/
  web/       React + Vite frontend (npm workspace @kintara/web)
  server/    Rust + Axum backend
    migrations/  sqlx migrations — the schema source of truth
    src/         config, db, error, state, routes/
    tests/       schema.rs, api.rs
  desktop/   Tauri shell — frozen, retained for reference
assets/      Brand source images, not bundled
docker/      Dockerfile, entrypoint, compose — not yet implemented
DOCS/        This file, ROADMAP.md, to-do.md
```
The root `package.json` is the version source of truth and delegates scripts to the
`apps/web` workspace. `apps/desktop` is pinned at 0.6.2 because it is frozen.

## Server
A single binary serves both the JSON API (under `/api`) and the built frontend. Unmatched
paths fall back to `index.html` for the client router, except under `/api`, which returns
a JSON 404.

### Configuration
All configuration is environment-driven. Defaults are relative paths so `cargo run` works
from `apps/server` with no setup; the container overrides them with absolute paths.

| Variable | Default | Purpose |
|---|---|---|
| `KINTARA_LIBRARY_DIR` | `./data/library` | Document root. All `relative_path` values resolve against it. |
| `KINTARA_DATA_DIR` | `./data` | Database and thumbnails. Kept off the library share — SQLite over SMB/NFS corrupts. |
| `KINTARA_WEB_DIR` | `../web/dist` | Built frontend to serve. |
| `KINTARA_BIND` | `0.0.0.0:8080` | Listen address. |
| `KINTARA_LOG` | `kintara_server=info` | `tracing` filter. |

### Database
SQLite via sqlx, opened with WAL, `synchronous=NORMAL`, foreign keys on, and a 10s busy
timeout. WAL is what makes concurrent reads viable during a write; the busy timeout covers
the rest. Foreign key enforcement is per-connection in SQLite, so it is set on the pool's
connect options and asserted in the test suite rather than assumed.

Schema differences from the desktop version are listed in `migrations/0001_initial.sql`
and in the 0.7.0 changelog entry. The important one: paths are stored relative to the
library root, so the volume can move.

Search uses an FTS5 external-content table kept in sync by insert/update/delete triggers,
so the document text is not stored twice.

### Tests
`cargo test` from `apps/server`. Tests run against real SQLite files in temp directories
and drive the real router — there are no mocks. They cover migrations, pragma enforcement,
cascade deletes, constraints, FTS trigger sync, and routing.

## Architecture
- **Frontend**: React, Vite, TypeScript
- **Styling**: Vanilla CSS (monochromatic dark/light modes with purple `#410186` accents)
- **Backend/Desktop Layer**: Tauri (Rust)
- **Database**: SQLite (via Tauri Rust commands)

## Design System
The UI relies on a flexible 3-pane layout: Sidebar (Libraries/Collections), Main View (Grid or Reader), and Details Sidebar. The styling uses native CSS variables to ensure highly performant and flexible theming.

## Data Flow
- Frontend interacts with Rust backend via Tauri IPC (`invoke` commands).
- Backend manages the managed library folder and SQLite instance for metadata retrieval. Search is currently a `LIKE '%term%'` scan across title/author/summary/keywords — FTS5 is planned for the server rewrite, not yet implemented.
- Local resource loading is enabled securely via Tauri's `assetProtocol` configured with scopes inside `tauri.conf.json`, allowing the React frontend to render cached PDF and custom cover thumbnails via `convertFileSrc()`.
- Native Tauri dialog bindings (`@tauri-apps/plugin-dialog`) are used selectively for destructive confirmations (e.g. deleting imports).

## Annotation System
- Highlights are stored in the `annotations` SQLite table (`annotation_type`, `serialized_position`, `content`, `color`).
- **Markdown reader**: text selection on `mouseup` immediately creates an annotation — no confirmation dialog. Existing highlights are injected as `<mark data-annotation-id="...">` elements; clicking one calls `annotationService.delete()` via event delegation.
- **PDF reader**: click-drag draws a bounding box highlight stored as `{ page, x, y, w, h }`. Clicking an existing highlight box removes it, with hover opacity feedback.
- **Highlight color** is user-configurable (8 presets) in Settings. The chosen color is written to the `--highlight-color` CSS custom property on `<html>` at startup and on every settings change. Both readers read this property at the moment of annotation creation, so existing highlights always retain their original color.

## Library & Collection Management
- Libraries and Collections are stored in SQLite with cascade-delete foreign keys.
- Each library supports a custom **Lucide icon** and **icon color** (stored as `icon TEXT` and `icon_color TEXT` columns, added in migration v3).
- A **LibrarySettingsModal** (`apps/web/src/components/LibrarySettingsModal.tsx`) provides a unified UI for renaming, deleting, and customizing icons/colors for both libraries and collections.
- The sidebar renders the library's chosen icon with the stored color, falling back to `FolderOpen` if none is set.
- Settings and delete controls appear in the main header bar when a library or collection view is active.


## Distribution & Bundling
Frozen alongside the desktop shell. `apps/desktop/tauri.conf.json` still declares `.deb`,
`.appimage`, `.rpm`, and NSIS targets, but nothing builds them — the Windows CI workflow
was removed in 0.6.2.

The replacement is a multi-arch (`linux/amd64`, `linux/arm64`) Docker image published
from `docker/`, mounting `/library` for documents and `/data` for the database and
thumbnails, with `PUID`/`PGID` handling for NAS filesystem permissions.
