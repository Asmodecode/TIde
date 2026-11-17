// Assembly in the browser and the desktop app alike: spasm-ng compiled to WebAssembly (toolchain/spasm).
// It assembles TI-83 Plus / 84 Plus z80 and, with -E, TI-84 Plus CE eZ80, straight to an .8xp.
// The project's files go into the assembler's own file system, with spasm-ng's include files
// (ti83plus.inc, ti84pce.inc…) in /inc, so #include works as it would on disk.
import spasmScript from "/toolchain/spasm/dist/Spasm.js?url";
import spasmWasm from "/toolchain/spasm/dist/Spasm.wasm?url";

const INCLUDES = import.meta.glob("/toolchain/spasm/dist/*.inc", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

interface SpasmModule {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array | string): void;
    readFile(path: string): Uint8Array;
    chdir(path: string): void;
    analyzePath(path: string): { exists: boolean };
  };
  callMain(args: string[]): number;
}
type Factory = (options: Record<string, unknown>) => Promise<SpasmModule>;

let loaded: Promise<{ factory: Factory; wasm: ArrayBuffer; includes: [string, string][] }> | null = null;
function load() {
  return (loaded ??= (async () => {
    const [factory, wasm, includes] = await Promise.all([
      import(/* @vite-ignore */ spasmScript).then(m => m.default as Factory),
      fetch(spasmWasm).then(r => r.arrayBuffer()),
      Promise.all(Object.entries(INCLUDES).map(async ([path, get]) => [path.split("/").pop()!, await get()] as [string, string])),
    ]);
    return { factory, wasm, includes };
  })().catch(err => { loaded = null; throw err; }));
}

export interface AssembleResult {
  ok: boolean;
  /** spasm-ng's own output: errors and warnings with their file and line. */
  log: string;
  /** The .8xp, when it assembled. */
  bytes?: Uint8Array;
}

/**
 * Assembles `main` (a path relative to the project, with "/") into an .8xp named `program`.
 * `files` are the project's files by the same relative paths.
 */
export async function assemble(files: Map<string, Uint8Array>, main: string, program: string, ez80: boolean): Promise<AssembleResult> {
  const { factory, wasm, includes } = await load();
  const lines: string[] = [];
  let code: number | null = null;
  // A fresh instance each time: spasm-ng keeps its state in globals.
  const spasm = await factory({
    wasmBinary: wasm,
    locateFile: (f: string) => f,
    print: (t: string) => lines.push(t),
    printErr: (t: string) => lines.push(t),
    onExit: (c: number) => { code = c; },
  });
  spasm.FS.mkdirTree("/inc");
  for (const [name, text] of includes) spasm.FS.writeFile(`/inc/${name}`, text);
  for (const [path, bytes] of files) {
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) spasm.FS.mkdirTree(`/proj/${dir}`);
    spasm.FS.writeFile(`/proj/${path}`, bytes);
  }
  spasm.FS.mkdirTree("/proj");
  spasm.FS.chdir(`/proj/${main.split("/").slice(0, -1).join("/")}`);
  const out = `/out/${program}.8xp`;
  spasm.FS.mkdirTree("/out");
  try {
    const result = spasm.callMain([...(ez80 ? ["-E"] : []), "-I", "/inc", "-I", "/proj", `/proj/${main}`, out]);
    code ??= result;
  } catch (err) {
    // exit() inside the assembler ends up here with its status.
    const status = (err as { status?: number }).status;
    if (typeof status !== "number") throw err;
    code = status;
  }
  const made = spasm.FS.analyzePath(out).exists;
  const bytes = made ? spasm.FS.readFile(out) : undefined;
  const log = lines.join("\n");
  const failed = code !== 0 || !made || /\berror\b/i.test(log);
  return { ok: !failed, log, bytes: failed ? undefined : bytes };
}

/** A TI-OS program name from a file name: up to 8 letters and digits, starting with a letter. */
export function programName(file: string): string {
  const base = file.replace(/\.[^.]*$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^[0-9]+/, "");
  return (base || "ASM").slice(0, 8);
}
