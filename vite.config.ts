import { defineConfig, type Plugin } from "vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;
const ISOLATION = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless" };

/**
 * The web version as an installable app (a PWA): its manifest and icons, and the link to them in
 * the page. Web builds only; the desktop app is an app already. The nightly (at /TIde/nightly/)
 * installs as its own app, "TIde Nightly", beside the stable one. The service worker is
 * public/isolate.js, which also keeps the site for offline use.
 */
function pwa(base: string): Plugin {
  const nightly = base.endsWith("/nightly/");
  const name = nightly ? "TIde Nightly" : "TIde";
  const icons = ["icon-192.png", "icon-512.png", "icon-maskable-512.png"];
  return {
    name: "tide-pwa",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "link", attrs: { rel: "manifest", href: `${base}manifest.webmanifest` }, injectTo: "head" },
      { tag: "meta", attrs: { name: "theme-color", content: "#0f1f3f" }, injectTo: "head" },
    ],
    generateBundle() {
      for (const icon of icons) this.emitFile({ type: "asset", fileName: `pwa/${icon}`, source: readFileSync(`pwa/${icon}`) });
      const manifest = {
        name, short_name: name,
        description: "An IDE for TI calculators: TI-BASIC, C, assembly, Python and Lua, with every calculator emulated.",
        id: base, start_url: base, scope: base,
        display: "standalone",
        background_color: "#0f1f3f", theme_color: "#0f1f3f",
        icons: [
          { src: `${base}pwa/icon-192.png`, sizes: "192x192", type: "image/png" },
          { src: `${base}pwa/icon-512.png`, sizes: "512x512", type: "image/png" },
          { src: `${base}pwa/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      };
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify(manifest, null, 2) });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // The web version is served from GitHub Pages: the stable one at /TIde/, the nightly at
  // /TIde/nightly/ (the build workflow sets TIDE_WEB_BASE for it); the desktop app from the root.
  base: mode === "web" ? (process.env.TIDE_WEB_BASE || "/TIde/") : "/",
  plugins: mode === "web" ? [pwa(process.env.TIDE_WEB_BASE || "/TIde/")] : [],
  build: mode === "web" ? { outDir: "dist-web" } : {},
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,

  // Pre-bundle these once and cache them. Without this, Vite discovers them while the page loads,
  // re-bundles, and reloads, and Monaco is served as hundreds of separate files.
  optimizeDeps: {
    include: ["monaco-editor", "@tauri-apps/plugin-dialog"],
  },

  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    // Cross-origin isolation: the calculator link (public/webtilp) runs on WebAssembly threads.
    headers: ISOLATION,
    // Transform the entry and its imports as soon as the server starts, not on first request.
    warmup: { clientFiles: ["./src/main.ts"] },
  },
  preview: { headers: ISOLATION },
}));