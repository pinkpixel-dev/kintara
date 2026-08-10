import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));

/**
 * Asset directories pdf.js loads at runtime rather than bundling.
 *
 * `wasm` is the one that matters most: pdf.js 5 decodes JPEG 2000 and JBIG2
 * images through OpenJPEG and JBIG2 WebAssembly modules. Without them a scanned
 * page renders its text and vector art perfectly and simply omits the
 * photographs, which is a confusing way to fail. `iccs` handles colour
 * profiles, `cmaps` CJK text, and `standard_fonts` the base-14 fonts.
 */
const PDFJS_ASSET_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];

const CONTENT_TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".icc": "application/vnd.iccprofile",
  ".js": "text/javascript",
};

/**
 * Serves pdf.js runtime assets from node_modules in development, and copies
 * them into the build output for production. Vendoring them into `public/`
 * would mean 4 MB of binaries committed to the repository and drifting out of
 * step with the installed version.
 */
function pdfjsAssets(): Plugin {
  let config: ResolvedConfig;

  return {
    name: "kintara-pdfjs-assets",

    configResolved(resolved) {
      config = resolved;
    },

    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const relative = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const target = path.join(pdfjsRoot, relative);

        // Never serve outside the package, whatever the request path claims.
        if (!target.startsWith(pdfjsRoot) || !fs.existsSync(target)) {
          next();
          return;
        }

        const type = CONTENT_TYPES[path.extname(target)];
        if (type) res.setHeader("Content-Type", type);
        fs.createReadStream(target).pipe(res);
      });
    },

    async closeBundle() {
      const outDir = path.resolve(config.root, config.build.outDir, "pdfjs");
      for (const dir of PDFJS_ASSET_DIRS) {
        await fs.promises.cp(path.join(pdfjsRoot, dir), path.join(outDir, dir), {
          recursive: true,
        });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), pdfjsAssets()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // Without this, /api requests hit Vite itself, which answers every unknown
    // path with index.html. The client then gets 200 text/html where it expects
    // JSON, and every call fails with a parse error instead of working.
    proxy: {
      "/api": {
        target: process.env.KINTARA_DEV_API || "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching the frozen desktop shell
      ignored: ["**/apps/desktop/**"],
    },
  },
}));
