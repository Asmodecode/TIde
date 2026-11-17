// Files in the web version. Two kinds of folders, both as paths the rest of TIde uses unchanged:
// - real folders on your computer, opened with the browser's folder picker (Chrome and Edge), as
//   "/<folder name>/…"; TIde remembers them (in IndexedDB) and asks to reopen them after a reload;
// - projects kept in the browser's own storage (the origin private file system), on every browser,
//   as "/Browser/<project>/…".
// Files picked with an open dialog become "/picked/…", and save dialogs "/save/…", so they read and
// write like any other path. TIde's own data (extensions, calculator ROMs) is in browser storage too.

export interface WebEntry { name: string; path: string; isDir: boolean }

type Dir = FileSystemDirectoryHandle;
type FileH = FileSystemFileHandle;
interface Picker {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<Dir>;
  showSaveFilePicker?: (options?: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileH>;
}
const picker = window as unknown as Picker;
type Permissioned = Dir & {
  queryPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
};

export const BROWSER = "/Browser";
/** Whether this browser can open real folders. */
export const canOpenFolders = typeof picker.showDirectoryPicker === "function";

// ── Remembered folder handles, in IndexedDB ──

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("tide-web", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("folders");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = work(d.transaction("folders", mode).objectStore("folders"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Roots: the folders paths start from ──

const roots = new Map<string, Dir>();
const picked = new Map<string, File>();
const saves = new Map<string, FileH | null>(); // null: no save dialog here, so it downloads
let counter = 0;

async function opfs(): Promise<Dir> { return navigator.storage.getDirectory(); }
async function opfsDir(...parts: string[]): Promise<Dir> {
  let dir = await opfs();
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
  return dir;
}
const browserRoot = () => opfsDir("projects");

const split = (path: string) => path.split("/").filter(Boolean);

/** The root a path is under, and the parts after it. */
async function locate(path: string): Promise<{ root: Dir; rest: string[] }> {
  const parts = split(path);
  if (parts[0] === BROWSER.slice(1)) return { root: await browserRoot(), rest: parts.slice(1) };
  if (parts[0] === "tide") return { root: await opfsDir("tide"), rest: parts.slice(1) };
  let root = roots.get(`/${parts[0]}`);
  if (!root) {
    // A folder opened before a reload: TIde kept its handle, and asks to use it again.
    const kept = await idb<Dir | undefined>("readonly", s => s.get(`/${parts[0]}`)).catch(() => undefined);
    if (!kept) throw new Error(`${path} isn't in an open folder.`);
    await allow(kept);
    roots.set(`/${parts[0]}`, kept);
    root = kept;
  }
  return { root, rest: parts.slice(1) };
}

async function allow(dir: Dir) {
  const d = dir as Permissioned;
  if ((await d.queryPermission?.({ mode: "readwrite" })) === "granted") return;
  if ((await d.requestPermission?.({ mode: "readwrite" })) !== "granted") {
    throw new Error(`TIde needs your permission to open ${dir.name} again. Open it from the File menu.`);
  }
}

async function dirAt(path: string, create = false): Promise<Dir> {
  const { root, rest } = await locate(path);
  let dir = root;
  for (const p of rest) dir = await dir.getDirectoryHandle(p, { create });
  return dir;
}
async function fileAt(path: string, create = false): Promise<FileH> {
  const parts = split(path);
  const dir = await dirAt(`/${parts.slice(0, -1).join("/")}`, create);
  return dir.getFileHandle(parts[parts.length - 1], { create });
}

/** Registers a folder handle under a path of its own name, kept for after a reload. */
async function register(dir: Dir): Promise<string> {
  let path = `/${dir.name}`;
  for (let n = 2; roots.has(path) && !(await roots.get(path)!.isSameEntry(dir)); n++) path = `/${dir.name} (${n})`;
  if (path === BROWSER || path === "/tide" || path === "/picked" || path === "/save") path = `/${dir.name} (folder)`;
  roots.set(path, dir);
  await idb("readwrite", s => s.put(dir, path)).catch(() => { /* kept for this visit only */ });
  return path;
}

async function readBytes(path: string): Promise<Uint8Array> {
  const parts = split(path);
  if (parts[0] === "picked") {
    const file = picked.get(path);
    if (!file) throw new Error(`${path} is no longer available.`);
    return new Uint8Array(await file.arrayBuffer());
  }
  const file = await (await fileAt(path)).getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function writeBytes(path: string, bytes: Uint8Array | string) {
  const parts = split(path);
  if (parts[0] === "save") {
    const handle = saves.get(path);
    if (handle === undefined) throw new Error(`${path} is no longer available.`);
    if (handle === null) {
      // No save dialog in this browser: download it instead.
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([bytes as BlobPart])), download: parts[parts.length - 1] });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      return;
    }
    const w = await handle.createWritable();
    await w.write(bytes as BlobPart);
    await w.close();
    return;
  }
  const w = await (await fileAt(path, true)).createWritable();
  await w.write(bytes as BlobPart);
  await w.close();
}

/** An open dialog: the files become "/picked/…" paths. */
function choose(extensions: string[], multiple: boolean): Promise<string[]> {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement("input"), { type: "file", multiple, accept: extensions.map(e => `.${e}`).join(",") });
    input.addEventListener("change", () => {
      const paths = [...(input.files ?? [])].map(f => {
        const path = `/picked/${++counter}/${f.name}`;
        picked.set(path, f);
        return path;
      });
      resolve(paths);
    });
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

/** The browser projects, by name. */
async function browserProjects(): Promise<string[]> {
  const names: string[] = [];
  for await (const [name, h] of (await browserRoot()) as unknown as AsyncIterable<[string, FileSystemHandle]>) if (h.kind === "directory") names.push(name);
  return names.sort((a, b) => a.localeCompare(b));
}

export const webFs = {
  canOpenFolders,
  /** Opens a real folder where the browser allows it, otherwise a browser project. */
  async pickFolder(): Promise<string | null> {
    if (!canOpenFolders) return webFs.pickBrowserProject();
    try { return await register(await picker.showDirectoryPicker!({ mode: "readwrite", id: "tide" })); }
    catch (err) { if ((err as Error).name === "AbortError") return null; throw err; }
  },
  /** Opens or makes a project kept in this browser's storage. */
  async pickBrowserProject(): Promise<string | null> {
    const existing = await browserProjects();
    const name = prompt(existing.length
      ? `Open a project kept in this browser (${existing.join(", ")}), or type a new name to make one:`
      : "Name a new project, kept in this browser's storage:", existing[0] ?? "MyProject")?.trim();
    if (!name) return null;
    if (/[\\/:*?"<>|]/.test(name)) throw new Error(`A project name can't contain \\ / : * ? " < > |`);
    await (await browserRoot()).getDirectoryHandle(name, { create: true });
    return `${BROWSER}/${name}`;
  },
  async readDir(path: string): Promise<WebEntry[]> {
    const dir = await dirAt(path);
    const out: WebEntry[] = [];
    const base = path.replace(/\/+$/, "");
    for await (const [name, h] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) out.push({ name, path: `${base}/${name}`, isDir: h.kind === "directory" });
    return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.isDir ? -1 : 1));
  },
  readBinary: readBytes,
  readFile: async (path: string) => new TextDecoder().decode(await readBytes(path)),
  writeFile: (path: string, text: string) => writeBytes(path, text),
  writeBinary: (path: string, bytes: Uint8Array) => writeBytes(path, bytes),
  async createDir(path: string) { await dirAt(path, true); },
  async deletePath(path: string) {
    const parts = split(path);
    const parent = await dirAt(`/${parts.slice(0, -1).join("/")}`);
    await parent.removeEntry(parts[parts.length - 1], { recursive: true });
  },
  pickFile: async (_label: string, extensions: string[]) => (await choose(extensions, false))[0] ?? null,
  pickFiles: (_label: string, extensions: string[]) => choose(extensions, true),
  /** A save dialog where the browser has one; otherwise the file downloads when it's written. */
  async pickSaveFile(name: string, filter = { name: "TI-84 program", extensions: ["8xp"] }): Promise<string | null> {
    const path = `/save/${++counter}/${name}`;
    if (typeof picker.showSaveFilePicker !== "function") { saves.set(path, null); return path; }
    try {
      const handle = await picker.showSaveFilePicker({ suggestedName: name, types: [{ description: filter.name, accept: { "application/octet-stream": filter.extensions.map(e => `.${e}`) } }] });
      const real = `/save/${counter}/${handle.name}`;
      saves.set(real, handle);
      return real;
    } catch (err) { if ((err as Error).name === "AbortError") return null; throw err; }
  },
  /** clibs.8xg in the project (its root, bin/ or lib/). */
  async findClibs(root: string | null): Promise<string | null> {
    if (!root) return null;
    for (const dir of [root, `${root}/bin`, `${root}/lib`]) {
      const hit = (await webFs.readDir(dir).catch(() => [])).find(e => !e.isDir && e.name.toLowerCase() === "clibs.8xg");
      if (hit) return hit.path;
    }
    return null;
  },
  extensionsDir: async () => { await opfsDir("tide", "extensions"); return "/tide/extensions"; },
};

// ── The calculator's ROMs, in browser storage ──

/** The emulator cores, served with the site. */
const CORES = import.meta.glob("/emulator/*/dist/*.{js,wasm}", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const coreUrl = (name: string) => Object.entries(CORES).find(([path]) => path.endsWith(`/${name}`))?.[1];

export const webCalc = {
  async files(): Promise<{ rom: boolean; roms: string[] }> {
    const dir = await opfsDir("calculator");
    const romsDir = await opfsDir("calculator", "roms");
    const has = await dir.getFileHandle("CE.rom").then(() => true, () => false);
    const roms: string[] = [];
    for await (const [name, h] of romsDir as unknown as AsyncIterable<[string, FileSystemHandle]>) if (h.kind === "file") roms.push(name);
    return { rom: has, roms: roms.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })) };
  },
  async read(name: string): Promise<Uint8Array> {
    const url = coreUrl(name);
    if (url) return new Uint8Array(await (await fetch(url)).arrayBuffer());
    const parts = name.split("/");
    const dir = parts.length > 1 ? await opfsDir("calculator", ...parts.slice(0, -1)) : await opfsDir("calculator");
    const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
    return new Uint8Array(await file.arrayBuffer());
  },
  /** Keeps a ROM: 4 MB is the CE's, anything else goes with the other models. Returns "ce" or "rom:" and its name. */
  async setRom(path: string): Promise<string> {
    const bytes = await readBytes(path);
    if (bytes.length >= 0x400000 && bytes.length <= 0x400100) {
      const w = await (await (await opfsDir("calculator")).getFileHandle("CE.rom", { create: true })).createWritable();
      await w.write(bytes as BlobPart); await w.close();
      return "ce";
    }
    if (bytes.length < 0x4000 || bytes.length >= 0x400000) throw new Error(`That file is ${bytes.length} bytes, which isn't the size of a calculator ROM.`);
    const name = path.split("/").pop()!.replace(/[^\w .()[\]+-]/g, "_");
    const w = await (await (await opfsDir("calculator", "roms")).getFileHandle(name, { create: true })).createWritable();
    await w.write(bytes as BlobPart); await w.close();
    return `rom:${name}`;
  },
  async removeRom(name: string) { await (await opfsDir("calculator", "roms")).removeEntry(name); },
};
