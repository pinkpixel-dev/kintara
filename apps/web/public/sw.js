/*
 * Kintara service worker.
 *
 * Scope is deliberately narrow: it caches the app shell so Kintara opens
 * instantly and still loads when the NAS is briefly unreachable. It does not
 * cache documents or API responses — a stale library listing is worse than no
 * listing, and caching whole PDFs would fill a phone's storage budget quickly.
 */

const VERSION = "kintara-shell-v3";

// Precaching only the entry points; the hashed bundles are picked up at runtime.
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/assets/brand/logo.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // Individually, so one missing file does not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache Vite's dev-server paths. These are not content-hashed, so a
  // cache hit would pin the browser to whatever version it saw first.
  if (
    url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/src/") ||
    url.pathname.startsWith("/node_modules/")
  ) {
    return;
  }

  // Never cache the API. Reading state, library contents, and auth status all
  // change server-side, and serving a stale copy would show the wrong library.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: try the network so a deployed update is picked up, and fall
  // back to the cached shell when the server cannot be reached.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html").then((r) => r || Response.error())),
    );
    return;
  }

  // Static assets are content-hashed by Vite, so a cache hit is always correct
  // and a miss is worth storing.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
