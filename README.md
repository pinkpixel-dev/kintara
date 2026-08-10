# Kintara

A self-hosted document library and reader. Point it at the folder where your PDFs already
live, run it on your NAS, and read them from any device on your network.

## What it does

- **Watches a folder.** Copy a PDF onto your share over SMB and it appears in the library,
  with its title, author, page count, and a cover pulled out automatically. Rename or
  delete it on the share and Kintara keeps up.
- **Reads in the browser.** PDFs stream with range requests, so page turns are quick even
  on a phone and a large scan does not have to download in full first.
- **Organises without moving anything.** Libraries, collections, and tags are views over
  your files. Deleting a library never touches the documents inside it.
- **Highlights and remembers where you were.** Per user, so two people reading the same
  paper do not fight over the bookmark.
- **Installs as an app.** It is a PWA, so you can add it to a home screen and it opens
  like anything else.

## Running it

```yaml
services:
  kintara:
    image: ghcr.io/pinkpixel-dev/kintara:latest
    container_name: kintara
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      # Match the owner of your library share, or uploads will fail.
      # Find them with `id -u yourname` and `id -g yourname`.
      PUID: 1000
      PGID: 1000
    volumes:
      - /volume1/documents:/library   # your PDFs
      - ./kintara-data:/data          # database and thumbnails
```

Then open `http://your-nas:8080` and create your account. The first person to reach it
sets the password, so do that before exposing the port anywhere.

A ready-to-edit compose file is in [`docker/docker-compose.yml`](docker/docker-compose.yml).

### Keep `/data` off the share

`/library` is your documents and is usually a network share. `/data` holds the SQLite
database and must be on local disk — SQLite over SMB or NFS corrupts, and it is not a
subtle failure.

### Configuration

| Variable | Default | What it does |
|---|---|---|
| `PUID` / `PGID` | `1000` | User the server runs as. Match your share's owner. |
| `KINTARA_BIND` | `0.0.0.0:8080` | Listen address. |
| `KINTARA_SCAN_ON_START` | `true` | Sweep the library at startup. |
| `KINTARA_WATCH` | `true` | Watch for changes while running. Turn off if your share does not report filesystem events. |
| `KINTARA_LOG` | `kintara_server=info` | Log filter. |

## Developing

You need Rust, Node, and `poppler-utils` (for `pdfinfo` and `pdftoppm`).

```bash
npm install
npm run build --workspace apps/web    # build the frontend once

cd apps/server
cargo run                             # serves the API and the built frontend on :8080
cargo test                            # 106 tests, no mocks
```

Defaults are relative paths, so `cargo run` works from `apps/server` with no setup. For
frontend work, `npm run dev` gives you Vite's dev server against the running API.

### Layout

```
apps/
  server/   Rust + Axum. Serves the API and the built frontend.
  web/      React + Vite. Talks to the API over HTTP, nothing else.
  desktop/  The original Tauri shell. Frozen, kept for reference.
docker/     Dockerfile, entrypoint, compose file.
```

## Known limits

- Fonts are loaded from Google Fonts, so on a fully offline NAS the app falls back to
  system fonts. It works; it just looks wrong.
- The PDF reader has no pinch-zoom or swipe paging yet.
- Single library root. Multiple shares are not supported.

## License

Apache 2.0. See [LICENSE](LICENSE).

---

Made with 💖 by Pink Pixel
