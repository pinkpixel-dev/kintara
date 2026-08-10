import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import { applySettings, loadSettings } from "./lib/settings";

// Applied before the first render rather than in an effect, so the sign-in
// screen is already themed and nothing flashes from light to dark.
applySettings(loadSettings());

/**
 * The service worker caches static assets cache-first, which is correct for a
 * production build where Vite content-hashes every filename. In development it
 * is actively harmful: Vite serves modules at stable URLs like
 * /src/App.tsx, so the first version fetched would be served forever and code
 * changes would never appear.
 *
 * So: register only in production, and in development tear down any worker and
 * cache left behind by an earlier build, which would otherwise keep serving
 * stale code on this machine indefinitely.
 */
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Unsupported, or blocked on a non-secure origin that is not localhost.
        // The app works fine without it.
      });
    });
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) registration.unregister();
    });
    if ("caches" in window) {
      caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
    }
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>,
);
