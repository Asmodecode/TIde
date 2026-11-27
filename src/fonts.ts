// TIde's font, for the window, the editor and the terminal alike. Default keeps TIde's pair, Inter
// for the window and JetBrains Mono for code; System uses the computer's own pair. Any other font
// is used everywhere. The bundled ones load only when picked, so they work offline and in the
// browser without slowing TIde's start; "Font file" is a .ttf, .otf, .woff or .woff2 you chose,
// which TIde keeps a copy of.

import * as monaco from "monaco-editor";

export interface Font {
  id: string;
  name: string;
  /** The CSS font-family lists for the window and for code. */
  ui: string;
  code: string;
  /** Loads the bundled font's files; absent for the defaults (main.ts imports them) and system fonts. */
  load?: () => Promise<unknown>;
}

const MONO_FALLBACK = `"Cascadia Code", "SF Mono", Consolas, monospace`;
const UI_FALLBACK = `system-ui, -apple-system, "Segoe UI", sans-serif`;
/** One font for both, falling back to the right kind for each. */
const both = (family: string) => ({ ui: `${family}, ${UI_FALLBACK}`, code: `${family}, ${MONO_FALLBACK}` });

export const FONTS: Font[] = [
  { id: "default", name: "Default (Inter and JetBrains Mono)", ui: `"Inter Variable", ${UI_FALLBACK}`, code: `"JetBrains Mono Variable", ${MONO_FALLBACK}` },
  { id: "jetbrains-mono", name: "JetBrains Mono", ...both(`"JetBrains Mono Variable"`) },
  { id: "fira-code", name: "Fira Code", ...both(`"Fira Code Variable"`), load: () => import("@fontsource-variable/fira-code") },
  { id: "source-code-pro", name: "Source Code Pro", ...both(`"Source Code Pro Variable"`), load: () => import("@fontsource-variable/source-code-pro") },
  { id: "roboto-mono", name: "Roboto Mono", ...both(`"Roboto Mono Variable"`), load: () => import("@fontsource-variable/roboto-mono") },
  {
    id: "ibm-plex-mono", name: "IBM Plex Mono", ...both(`"IBM Plex Mono"`),
    load: () => Promise.all([import("@fontsource/ibm-plex-mono/400.css"), import("@fontsource/ibm-plex-mono/600.css")]),
  },
  { id: "inter", name: "Inter", ...both(`"Inter Variable"`) },
  { id: "ibm-plex-sans", name: "IBM Plex Sans", ...both(`"IBM Plex Sans Variable"`), load: () => import("@fontsource-variable/ibm-plex-sans") },
  { id: "source-sans-3", name: "Source Sans 3", ...both(`"Source Sans 3 Variable"`), load: () => import("@fontsource-variable/source-sans-3") },
  { id: "system", name: "System", ui: UI_FALLBACK, code: `ui-monospace, ${MONO_FALLBACK}` },
];

/** "Font file" in the Settings list: a .ttf, .otf, .woff or .woff2 you chose, kept by TIde. */
export const FILE = "file";

// ── Font files you chose: kept in IndexedDB (in the desktop app as in the browser), ──
interface StoredFont { name: string; data: ArrayBuffer }
const FAMILY = "TIde Font File";
const KEY = "font";
const MAX_FONT_BYTES = 20 * 1024 * 1024;

function fontStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("tide-fonts", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("files");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result.transaction("files", mode).objectStore("files"));
  });
}
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** The file's name, once it's been read (for Settings to show), and its loaded face. */
let fileName = "";
let loadedFace: FontFace | undefined;
let fileVersion = 0;

/** The chosen file's name, or "" if there is none (or it hasn't been read yet). */
export const fontFileName = () => fileName;

/** Reads the stored file and adds it to the page's fonts, once per file. */
async function loadFontFile(): Promise<boolean> {
  if (loadedFace) return true;
  try {
    const stored = await request((await fontStore("readonly")).get(KEY)) as StoredFont | undefined;
    if (!stored) return false;
    const face = await new FontFace(FAMILY, stored.data).load();
    document.fonts.add(face);
    loadedFace = face;
    fileName = stored.name;
    return true;
  } catch {
    return false;
  }
}

/** Reads the stored file's name, so Settings can show it before it's used. */
export async function readFontFileName() {
  try {
    const stored = await request((await fontStore("readonly")).get(KEY)) as StoredFont | undefined;
    if (stored) fileName = stored.name;
  } catch { /* storage unavailable */ }
}

/**
 * Asks for a font file and keeps it. Resolves to its name, or null if none was chosen;
 * throws if it isn't a font the browser can read.
 */
export function chooseFontFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" });
    input.addEventListener("cancel", () => resolve(null));
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        if (file.size > MAX_FONT_BYTES) throw new Error(`${file.name} is over 20 MB.`);
        const data = await file.arrayBuffer();
        // Checks it's a font before keeping it.
        const face = await new FontFace(FAMILY, data).load().catch(() => {
          throw new Error(`${file.name} isn't a font TIde can read (use .ttf, .otf, .woff or .woff2).`);
        });
        await request((await fontStore("readwrite")).put({ name: file.name, data } satisfies StoredFont, KEY));
        if (loadedFace) document.fonts.delete(loadedFace);
        document.fonts.add(face);
        loadedFace = face;
        fileName = file.name;
        fileVersion++;
        resolve(file.name);
      } catch (e) {
        reject(e);
      }
    });
    input.click();
  });
}

/** The font for a choice: a listed one, or the file you chose. */
function fontFor(id: string): Font {
  if (id === FILE) return { id: FILE, name: "", ...both(`"${FAMILY}"`), load: () => loadFontFile() };
  return FONTS.find(f => f.id === id) ?? FONTS[0];
}

let applied = "";
/**
 * Sets --mono and --ui, which the window, the editor and the terminal use, loading a bundled font
 * first. The editor and the terminal re-measure once the font is in.
 */
export async function applyFonts(s: { font: string }, editor: monaco.editor.IStandaloneCodeEditor) {
  const font = fontFor(s.font);
  const key = `${font.ui}|${font.code}|${fileVersion}`;
  if (key === applied) return;
  applied = key;
  await font.load?.().catch(() => undefined);
  if (applied !== key) return; // a later choice won
  const root = document.documentElement.style;
  root.setProperty("--mono", font.code);
  root.setProperty("--ui", font.ui);
  editor.updateOptions({ fontFamily: font.code });
  await document.fonts.load(`13px ${font.code.split(",")[0]}`).catch(() => undefined);
  await document.fonts.load(`13px ${font.ui.split(",")[0]}`).catch(() => undefined);
  monaco.editor.remeasureFonts();
  window.dispatchEvent(new Event("tide-fonts"));
}
