import { defineConfig } from "vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;
const ISOLATION = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless" };

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // The web version is served from GitHub Pages at /TIde/; the desktop app from the root.
  base: mode === "web" ? "/TIde/" : "/",
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