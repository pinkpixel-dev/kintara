<p align="center">
  <img src="assets/logo.png" alt="Kintara logo" width="300" height="300">
</p>

# Kintara

Kintara is a self-hosted document library and reader. It watches an existing document
folder, indexes its contents, and serves the library through a browser or installable PWA.

## What Kintara does

- Watches one folder for PDF, Markdown, and text documents. Documents can also be manually imported.
- Extracts PDF metadata, searchable text, page counts, and cover thumbnails with Poppler.
- Streams PDFs with HTTP Range support, so large files do not need one full download.
- Keeps libraries, collections, highlights, favorites, and reading progress per user.
- Supports private libraries with viewer and editor sharing.
- Uses GitHub OAuth for sign-in and administrator invitations for new accounts.
- Offers optional OpenAI and Google features with a separate provider key for each user.

Kintara runs as one Rust server. The server hosts the API and the built React frontend on
the same port.

## Install with Docker Compose

### Requirements

Prepare these items before you start:

- Docker Engine with the Docker Compose plugin
- A folder that contains your documents
- A local folder for Kintara data
- A GitHub OAuth app
- The user ID and group ID that can access the document folder

The published image supports `linux/amd64` and `linux/arm64`.

### 1. Prepare the folders

Create one folder for the Compose file and Kintara data. Keep the data folder on a local
disk.

```bash
mkdir -p ~/kintara/data
cd ~/kintara
```

Your document folder can be an existing NAS share. The container mounts this folder at
`/library`.

Kintara stores its SQLite database, thumbnails, sessions, and encryption key under
`/data`. Do not put `/data` on SMB or NFS. SQLite can corrupt on a network filesystem.

### 2. Find the share owner

Run these commands on the Docker host. Replace `yourname` with the account that owns the
document folder.

```bash
id -u yourname
id -g yourname
```

Use the two returned numbers for `PUID` and `PGID`. Kintara uses this identity for uploads,
cover files, and deletions. The container does not change ownership of the document folder.

### 3. Create the GitHub OAuth app

Open your GitHub developer settings and create an OAuth app for Kintara. Use the address
that readers will enter in their browsers.

For this example, the Kintara address is:

```text
https://kintara.example.com
```

Set the authorization callback URL to:

```text
https://kintara.example.com/api/auth/github/callback
```

The scheme, host, and port must match the browser address. The callback path must be
exactly `/api/auth/github/callback`. Copy the client ID and create a client secret.

### 4. Create the environment file

Save the deployment values in `~/kintara/.env`. Replace every example value.

```dotenv
PUID=1000
PGID=1000
KINTARA_PUBLIC_URL=https://kintara.example.com
KINTARA_GITHUB_CLIENT_ID=your-oauth-client-id
KINTARA_GITHUB_CLIENT_SECRET=your-oauth-client-secret
```

Limit access to this file because it contains the OAuth client secret.

```bash
chmod 600 .env
```

Do not commit `.env` to the repository.

### 5. Create `compose.yaml`

Save this file as `compose.yaml` inside `~/kintara`. Replace the example values before you
start the container.

```yaml
services:
  kintara:
    image: ghcr.io/pinkpixel-dev/kintara:latest
    container_name: kintara
    restart: unless-stopped

    ports:
      - "8080:8080"

    environment:
      PUID: "${PUID}"
      PGID: "${PGID}"
      TZ: Etc/UTC
      KINTARA_PUBLIC_URL: "${KINTARA_PUBLIC_URL}"
      KINTARA_GITHUB_CLIENT_ID: "${KINTARA_GITHUB_CLIENT_ID}"
      KINTARA_GITHUB_CLIENT_SECRET: "${KINTARA_GITHUB_CLIENT_SECRET}"

    volumes:
      - /path/to/your/documents:/library
      - ./data:/data

    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8080/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

The repository also contains a commented example at
[`docker/docker-compose.yml`](docker/docker-compose.yml).

The host path on the left side of `/path/to/your/documents:/library` is the folder that
Kintara scans and watches. Replace it with your document folder or mounted NAS share.

### 6. Start Kintara

Pull the image and start the service.

```bash
docker compose pull
docker compose up -d
```

Make sure that the container becomes healthy.

```bash
docker compose ps
curl http://127.0.0.1:8080/api/health
```

The health endpoint returns the server status, version, and indexed document count. It
also runs a database query, so a broken data mount does not report as healthy.

Open the configured Kintara address. The first GitHub account to sign in becomes the
installation owner. An administrator must invite each later account by GitHub username.

## Docker storage and permissions

Kintara uses two separate mounts:

| Container path | Contents | Storage rule |
|---|---|---|
| `/library` | PDF, Markdown, and text documents | Can be an existing NAS share |
| `/data` | SQLite, thumbnails, sessions, and `kintara-ai.key` | Must be on local storage |

The startup script changes ownership of `/data` to `PUID` and `PGID`. It never changes
ownership of `/library`. If `/library` is not writable, reading and scanning still work.
Uploads, cover writes, and permanent deletion will fail.

Files discovered by the scanner belong to the installation owner. Browser uploads belong
to the account that uploaded them.

## Docker configuration

| Variable | Default | Purpose |
|---|---|---|
| `PUID` | `1000` | User ID that runs Kintara |
| `PGID` | `1000` | Group ID that runs Kintara |
| `TZ` | Image default | Container timezone |
| `KINTARA_BIND` | `0.0.0.0:8080` | Server listen address |
| `KINTARA_SCAN_ON_START` | `true` | Scans the full document folder during startup |
| `KINTARA_WATCH` | `true` | Watches the document folder for live changes |
| `KINTARA_MAX_UPLOAD_MB` | `1024` | Maximum browser upload size in megabytes |
| `KINTARA_LOG` | `kintara_server=info,tower_http=warn,warn` | Rust tracing filter |
| `KINTARA_PUBLIC_URL` | none | Browser origin used for the OAuth callback |
| `KINTARA_GITHUB_CLIENT_ID` | none | GitHub OAuth client ID |
| `KINTARA_GITHUB_CLIENT_SECRET` | none | GitHub OAuth client secret |
| `KINTARA_SECRET` | generated file | Optional provider-key encryption source of 32 or more characters |

GitHub login stays disabled unless all three OAuth variables are set. Kintara stops during
startup if only part of the OAuth configuration is present.

If `KINTARA_SECRET` is absent, Kintara creates `/data/kintara-ai.key`. Back up this key
with the database. Saved OpenAI and Google keys cannot be decrypted without it.

Some network shares do not report filesystem events. Set `KINTARA_WATCH: "false"` if the
watcher cannot follow your share. Keep `KINTARA_SCAN_ON_START` enabled so each restart
finds changes.

## Reverse proxies

Set `KINTARA_PUBLIC_URL` to the browser-facing origin, not the container address. For
example, use `https://kintara.example.com` when a reverse proxy sends traffic to port
`8080`.

The GitHub callback must use the same origin:

```text
https://kintara.example.com/api/auth/github/callback
```

Kintara serves the API, frontend, document streams, and OAuth routes from one origin. The
proxy must pass normal requests and HTTP Range headers to the container.

## Update the container

Pull the current image and recreate the service.

```bash
cd ~/kintara
docker compose pull
docker compose up -d
```

Then make sure that the new container is healthy.

```bash
docker compose ps
docker compose logs --tail=100 kintara
```

Database migrations run when the new server starts. Back up `/data` before each update.

## Back up and restore

The document folder remains your source library. Back up the full `/data` mount to keep
accounts, libraries, collections, reading state, thumbnails, and saved provider keys.

Stop Kintara before you copy the data folder. This gives the backup a consistent SQLite
state.

```bash
cd ~/kintara
docker compose stop kintara
tar -C . -czf "kintara-data-$(date +%Y-%m-%d).tar.gz" data
docker compose start kintara
```

CAUTION: A restore replaces the current database, sessions, and provider-key encryption
file. Keep the current data folder until the restored installation works.

To restore, stop Kintara and place the backed-up `data` folder beside `compose.yaml`. Then
start the service and make sure that it becomes healthy.

## Logs and troubleshooting

### The container does not become healthy

Read the startup log.

```bash
docker compose logs --tail=200 kintara
```

Make sure that `/data` is writable and stored on local disk. Also make sure that port
`8080` is available on the host.

### GitHub login is not configured

Set all three GitHub variables. Then restart the service.

```bash
docker compose up -d
```

Make sure that `KINTARA_PUBLIC_URL` and the callback in GitHub use the same origin.

### Uploads or deletions fail

Compare `PUID` and `PGID` with the owner of the mounted document folder. The startup log
warns when the container cannot write to `/library`.

### Files copied to the share do not appear

Restart Kintara to run the startup scan.

```bash
docker compose restart kintara
```

If the restart finds the files, the share does not send usable watcher events. Disable
`KINTARA_WATCH` and keep startup scanning enabled.

### Recover the installation owner

Use the local recovery command if the installation owner loses GitHub access. The command
needs the numeric GitHub user ID and current login.

```bash
docker compose run --rm kintara \
  /app/kintara-server recover-owner GITHUB_NUMERIC_ID GITHUB_LOGIN
```

This command changes the installation administrator and deletes existing sessions. Sign
in again after it finishes.

## Build the image locally

Clone the repository and run the build from its root.

```bash
docker build -f docker/Dockerfile -t kintara:local .
```

Change the Compose image to `kintara:local` before you start the local build. The
multi-stage Dockerfile builds the React frontend and Rust server, then adds Poppler to a
slim Debian runtime.

## AI keys and privacy

AI is disabled for each account until that person saves a provider key and enables it.
Kintara encrypts provider keys before they enter SQLite. The browser never receives a
saved key.

OpenAI Responses and Google Interactions requests use `store: false`. OpenAI image
generation has no matching retention setting, so Kintara discloses that exception before
the request. Kintara does not run automatic or background AI processing.

## Development

Install Rust, Node.js, and `poppler-utils`.

```bash
npm install
npm run dev
npm test
```

`npm run dev` starts the API on port `8080` and Vite on port `1420`. Vite proxies `/api`
to the Rust server. Set `KINTARA_DEV_API` to use another API address. Local development
scans and watches `apps/server/data/library` by default. Set `KINTARA_LIBRARY_DIR` before
you start the server to use another document folder.

Build the frontend and let the Rust server host it:

```bash
npm run build
cd apps/server
cargo run
```

## Repository layout

```text
apps/
  server/   Rust and Axum API, scanner, authentication, and static hosting
  web/      React and Vite PWA
assets/     Brand images and package icons
docker/     Dockerfile, entrypoint, and Compose example
scripts/    Project checks and asset utilities
```

## Known limits

- The PDF reader has no pinch zoom or swipe paging.
- Kintara supports one document root per installation.
- Kintara does not provide an OPDS feed.

## License

Kintara uses the Apache License 2.0. See [LICENSE](LICENSE).

---

Made with 💖 by Pink Pixel
