# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- frontend
FROM node:22-bookworm-slim AS web

WORKDIR /build
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
# npm ci needs the workspace manifests present before it can resolve the tree.
RUN npm ci

COPY apps/web apps/web
RUN npm run build --workspace apps/web


# ------------------------------------------------------------ rust planner
# cargo-chef records just the dependency graph, so the expensive dependency
# build below is cached until Cargo.toml actually changes rather than being
# redone every time a source file is touched.
FROM rust:1.96-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /build

FROM chef AS planner
COPY apps/server .
RUN cargo chef prepare --recipe-path recipe.json


# --------------------------------------------------------------- rust build
FROM chef AS server
COPY --from=planner /build/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

COPY apps/server .
RUN cargo build --release --locked && strip target/release/kintara-server


# ----------------------------------------------------------------- runtime
FROM debian:bookworm-slim AS runtime

# poppler-utils provides pdfinfo and pdftoppm, which the server shells out to
# for metadata and cover thumbnails. gosu drops privileges in the entrypoint,
# and curl is only here for the healthcheck — bookworm-slim ships neither curl
# nor wget.
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        poppler-utils \
        ca-certificates \
        gosu \
        curl \
    && rm -rf /var/lib/apt/lists/*

# A fixed default that the entrypoint remaps to PUID/PGID at start-up. NAS
# shares almost never line up with a hardcoded uid.
RUN groupadd --gid 1000 kintara \
    && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin kintara

WORKDIR /app
COPY --from=server /build/target/release/kintara-server /app/kintara-server
COPY --from=web /build/apps/web/dist /app/web
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV KINTARA_LIBRARY_DIR=/library \
    KINTARA_DATA_DIR=/data \
    KINTARA_WEB_DIR=/app/web \
    KINTARA_BIND=0.0.0.0:8080 \
    KINTARA_LOG=kintara_server=info,tower_http=warn,warn \
    PUID=1000 \
    PGID=1000

# /library holds the documents and is usually also a network share.
# /data holds the SQLite database and thumbnails, and must not be on that share.
VOLUME ["/library", "/data"]
EXPOSE 8080

# /api/health runs a real COUNT against the database, so an unreachable database
# fails the check rather than reporting healthy because the socket is open.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/app/kintara-server"]
