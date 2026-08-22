# Kintara

A self-hosted document library and reader. Point it at the folder where your PDFs already
live, run it on your NAS, and read them from any device on your network.

## What it does

- **Watches a folder.** Copy a PDF onto your share over SMB and it appears in the library,
  with its title, author, page count, and a cover pulled out automatically. Rename or
  delete it on the share and Kintara keeps up.
- **Reads in the browser.** PDFs stream with range requests, so page turns are quick even
  on a phone and a large scan does not have to download in full first.
- **Keeps each person's libraries separate.** Your libraries are private until you share
  one with another Kintara user as a viewer or editor. Deleting a library never deletes
  the document files inside it.
- **Searches where you are looking.** Open a library or collection and the search box
  searches inside it, with one click to widen the same query to everything. It matches
  titles, authors, keywords, summaries, and tag names.
- **Highlights and remembers where you were.** Per user, so two people reading the same
  paper do not fight over the bookmark.
- **Installs as an app.** It is a PWA, so you can add it to a home screen and it opens
  like anything else.
- **Keeps access tied to GitHub.** The first GitHub account becomes the owner, and admins
  invite everyone else by GitHub username. Kintara keeps its own sessions, not passwords.
- **Adds AI only when you ask for it.** Each person can save their own encrypted OpenAI
  or Google key, then chat with a document, ask follow-up questions, and see page citations.

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
      KINTARA_PUBLIC_URL: https://kintara.example.com
      KINTARA_GITHUB_CLIENT_ID: your-oauth-app-client-id
      KINTARA_GITHUB_CLIENT_SECRET: set-this-in-your-nas-secret-manager
    volumes:
      - /volume1/documents:/library   # your PDFs
      - ./kintara-data:/data          # database and thumbnails
```

Create a GitHub OAuth app for the URL you use to reach Kintara. Set its callback URL to
`https://kintara.example.com/api/auth/github/callback`, then set the three matching
variables above. Open Kintara and continue with GitHub. The first GitHub account becomes
the installation owner; after that, an admin must invite each GitHub username in
Settings. Each invited person starts with an empty personal library area.

Library owners can share a library from its settings after the other person has signed in
once. A viewer can read its documents. An editor can also manage its documents and
collections. The person who owns a document remains the only person who can permanently
delete its file.

Files found by the NAS scanner belong to the installation owner. Files uploaded through
the browser belong to the person who uploaded them. The sidebar keeps owned and shared
libraries in separate collapsible sections, so another person's filing system can stay
out of the way until you need it.

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
| `KINTARA_MAX_UPLOAD_MB` | `1024` | Largest upload accepted. Magazine scans are big. |
| `KINTARA_LOG` | `kintara_server=info` | Log filter. |
| `KINTARA_PUBLIC_URL` | none | Public Kintara origin used to build the OAuth callback. Required with GitHub credentials. |
| `KINTARA_GITHUB_CLIENT_ID` | none | GitHub OAuth app client id. |
| `KINTARA_GITHUB_CLIENT_SECRET` | none | GitHub OAuth app client secret. Keep it out of the compose file when your NAS supports secrets. |
| `KINTARA_SECRET` | generated file | Optional 32+ character source for provider-key encryption. Otherwise `/data/kintara-ai.key` is created. |

### AI keys and privacy

AI is disabled per account until that person saves a provider key and turns it on. Keys
are encrypted before they enter SQLite and are never returned to the browser. Back up
`/data/kintara-ai.key` with `kintara.db`; losing it means replacing the saved provider
keys. Supplying `KINTARA_SECRET` instead is useful when your NAS already has a proper
secret manager.

The AI button appears only after you enable AI and open a document. Ask a question in the
right panel or use the Summarize action below the composer. Before a summary request,
Kintara shows the provider, model, approximate input tokens, and replacement warning.
OpenAI and Google requests always set `store: false`. Kintara stores each person's chat
history itself and sends only recent messages needed for a follow-up. There is no
automatic or background AI processing.

## Developing

You need Rust, Node, and `poppler-utils` (for `pdfinfo`, `pdftoppm`, and `pdftotext`).

```bash
npm install
npm run dev      # starts the API on :8080 and the frontend on :1420
npm test         # 157 tests, no mocks
```

`npm run dev` runs both halves — the frontend proxies `/api` to the server, so starting
only one gives you an app that cannot reach its backend. Point the proxy elsewhere with
`KINTARA_DEV_API`.

To run it the way the NAS does, build the frontend once and let the server host it:

```bash
npm run build
cd apps/server && cargo run    # everything on :8080, no proxy involved
```

### Layout

```
apps/
  server/   Rust + Axum. Serves the API and the built frontend.
  web/      React + Vite. Talks to the API over HTTP, nothing else.
assets/     Source icon, logo, and the packaging icon set.
docker/     Dockerfile, entrypoint, compose file.
```

## Known limits

- The PDF reader has no pinch-zoom or swipe paging yet.
- Single library root. Multiple shares are not supported.

## License

Apache 2.0. See [LICENSE](LICENSE).

---

Made with 💖 by Pink Pixel
