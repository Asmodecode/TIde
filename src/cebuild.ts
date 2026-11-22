// Building CE C, C++ and assembly projects in the browser: the CE toolchain's own programs (ez80-clang,
// the z80-none-elf assembler, linker and objcopy, cedev-obj and convbin), compiled to WebAssembly in
// toolchain/, run in the same steps as the toolchain's makefile.mk (the one without link-time
// optimization), with the toolchain's headers, libraries and linker scripts (toolchain/cedev).
// The desktop app runs make instead; this is for the web version.

const SCRIPTS = import.meta.glob("/toolchain/*/dist/*.js", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const BINARIES = import.meta.glob("/toolchain/*/dist/*.wasm", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const CEDEV_ARCHIVE = import.meta.glob("/toolchain/cedev/dist/cedev.tar.gz", { query: "?url", import: "default", eager: true }) as Record<string, string>;

type Tool = "clang" | "as" | "ld" | "objcopy" | "cedev-obj" | "convbin";
const url = (files: Record<string, string>, name: string) => Object.entries(files).find(([p]) => p.endsWith(`/${name}`))?.[1];

interface EmFS {
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  chdir(path: string): void;
}
interface EmModule { FS: EmFS; callMain(args: string[]): number }
type Factory = (options: Record<string, unknown>) => Promise<EmModule>;

/** Whether this build of TIde can compile C in the browser (the web version, with Clang built in). */
export const canBuildC = () => !!url(SCRIPTS, "clang.js") && !!url(BINARIES, "clang.wasm");

// Each program's script and WebAssembly, fetched once and compiled once.
const loaded = new Map<Tool, Promise<{ factory: Factory; module: WebAssembly.Module }>>();
function load(tool: Tool) {
  let got = loaded.get(tool);
  if (!got) {
    const script = url(SCRIPTS, `${tool}.js`), wasm = url(BINARIES, `${tool}.wasm`);
    if (!script || !wasm) throw new Error(tool === "clang" ? "This build of TIde doesn't include the C compiler." : `This build of TIde doesn't include ${tool}.`);
    got = Promise.all([
      import(/* @vite-ignore */ script).then(m => m.default as Factory),
      WebAssembly.compileStreaming(fetch(wasm)),
    ]).then(([factory, module]) => ({ factory, module }));
    got.catch(() => loaded.delete(tool));
    loaded.set(tool, got);
  }
  return got;
}

// ── The toolchain's headers, libraries and linker scripts, from cedev.tar.gz ──

let cedev: Promise<Map<string, Uint8Array>> | null = null;
function cedevFiles() {
  return (cedev ??= (async () => {
    const archive = url(CEDEV_ARCHIVE, "cedev.tar.gz");
    if (!archive) throw new Error("This build of TIde doesn't include the CE toolchain's libraries.");
    const tar = new Uint8Array(await new Response((await fetch(archive)).body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    const files = new Map<string, Uint8Array>();
    const text = (from: number, len: number) => new TextDecoder().decode(tar.subarray(from, from + len)).replace(/\0.*$/s, "");
    for (let at = 0; at + 512 <= tar.length;) {
      const name = text(at, 100);
      if (!name) break;
      const size = parseInt(text(at + 124, 12).trim() || "0", 8);
      const type = String.fromCharCode(tar[at + 156]);
      const prefix = text(at + 345, 155);
      const path = (prefix ? `${prefix}/${name}` : name).replace(/^\.\//, "");
      if (type === "0" || type === "\0") files.set(path, tar.slice(at + 512, at + 512 + size));
      at += 512 + Math.ceil(size / 512) * 512;
    }
    return files;
  })().catch(err => { cedev = null; throw err; }));
}

// ── Running one program ──

/** Files by absolute path in the programs' file system: /cedev (the toolchain) and /proj (the project). */
type Files = Map<string, Uint8Array>;

function writeAll(FS: EmFS, files: Files) {
  const made = new Set<string>();
  for (const [path, bytes] of files) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir && !made.has(dir)) { FS.mkdirTree(dir); made.add(dir); }
    FS.writeFile(path, bytes);
  }
}
function readTree(FS: EmFS, dir: string, into: Files) {
  let names: string[];
  try { names = FS.readdir(dir); } catch { return; }
  for (const name of names) {
    if (name === "." || name === "..") continue;
    const path = `${dir}/${name}`;
    if (FS.isDir(FS.stat(path).mode)) readTree(FS, path, into);
    else into.set(path, FS.readFile(path));
  }
}

/** Runs a tool in /proj with these files, and returns its exit code, its output, and the files it made in /proj/obj and /proj/bin. */
async function run(tool: Tool, args: string[], files: Files, log: (text: string, err: boolean) => void): Promise<{ code: number; made: Files }> {
  const { factory, module } = await load(tool);
  let code = 0;
  const out = await factory({
    instantiateWasm: (imports: WebAssembly.Imports, done: (i: WebAssembly.Instance) => void) => { WebAssembly.instantiate(module, imports).then(done); return {}; },
    print: (t: string) => log(`${t}\n`, false),
    printErr: (t: string) => log(`${t}\n`, true),
    onExit: (c: number) => { code = c; },
    thisProgram: tool === "clang" ? "ez80-clang" : tool,
  });
  writeAll(out.FS, files);
  out.FS.mkdirTree("/proj/obj");
  out.FS.mkdirTree("/proj/bin");
  out.FS.chdir("/proj");
  try {
    code = out.callMain(args) ?? code;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status !== "number") throw err;
    code = status;
  }
  const made: Files = new Map();
  readTree(out.FS, "/proj/obj", made);
  readTree(out.FS, "/proj/bin", made);
  return { code, made };
}

// ── The project's makefile ──

/** The makefile's variables: NAME = X, CFLAGS += -Y and so on (no functions or conditionals). */
export function makefileVars(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of text.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*([?:+]?=)\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, name, op, value] = m;
    if (op === "?=" && name in vars) continue;
    vars[name] = op === "+=" && vars[name] ? `${vars[name]} ${value}` : value;
  }
  return vars;
}

/** A rule of a makefile's own: what it needs first, and its recipe (shell commands). */
export interface MakeRule { prereqs: string[]; recipe: string[] }
/** A makefile's own rules, and which goal plain make starts from. */
export interface MakeGraph { rules: Map<string, MakeRule>; defaultGoal: string }

/**
 * A makefile's own rules (appvars: flash-app, all: package…), by target as written ($(MOD_VAR) stays
 * as it is: rules and prerequisites match by name), with their recipes. Special targets (.PHONY…)
 * don't count. The default goal is .DEFAULT_GOAL if it's set, otherwise the makefile's first rule
 * if that comes before the CE toolchain's makefile is included (make starts from the first rule it
 * reads), otherwise the toolchain's "all".
 */
export function makefileGraph(text: string): MakeGraph {
  const rules = new Map<string, MakeRule>();
  let current: MakeRule[] = [];
  let first: string | null = null;
  let included = false;
  let defaultGoal: string | null = null;
  for (const raw of text.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
    if (/^\t/.test(raw)) { // a recipe line, for the rules just read
      const command = raw.trim().replace(/^[@+-]+/, "").replace(/^\$\(Q\)\s*/, "");
      if (command) for (const r of current) r.recipe.push(command);
      continue;
    }
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const goal = /^\.DEFAULT_GOAL\s*:?=\s*(\S+)/.exec(line);
    if (goal) { defaultGoal = goal[1]; continue; }
    if (/^-?s?include\b/.test(line)) { if (/cedev-config|makefile\.mk/.test(line)) included = true; current = []; continue; }
    if (/^(?:ifeq|ifneq|ifdef|ifndef|else|endif|export|override|define|endef|vpath)\b/.test(line)) continue;
    const m = /^([^=:]+?)\s*::?(?!=)\s*(.*)$/.exec(line);
    if (!m || /[?+]$/.test(m[1])) { current = []; continue; } // a variable (VAR ?= x, VAR += x, VAR := x)
    const targets = m[1].split(/\s+/).filter(t => t && !t.startsWith("."));
    // "target: VAR = value" sets a variable for that target; it isn't a rule of its own.
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*[?:+]?=/.test(m[2])) { current = []; continue; }
    const prereqs = m[2].replace(/;.*$/, "").split("|").join(" ").split(/\s+/).filter(Boolean);
    current = targets.map(t => {
      const rule = rules.get(t) ?? { prereqs: [], recipe: [] };
      rule.prereqs.push(...prereqs);
      rules.set(t, rule);
      return rule;
    });
    const inline = /;\s*(.+)$/.exec(m[2]);
    if (inline) for (const r of current) r.recipe.push(inline[1]);
    if (!first && targets.length && !included) first = targets[0];
  }
  return { rules, defaultGoal: defaultGoal ?? first ?? "all" };
}

/** The targets a makefile defines rules for itself. */
export const makefileRules = (text: string) => [...makefileGraph(text).rules.keys()];

/** Something the browser's make can't do (an app, a shell recipe), as opposed to a build that failed. */
export class Unsupported extends Error {}

/** Splits flags like a shell would: spaces separate, quotes group. */
function words(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]);
}
const hex = (v: string) => `0x${v.replace(/^0x/i, "")}`;

export interface CeBuildResult { ok: boolean; name: string; program?: Uint8Array; files: Files }

/**
 * Builds a CE project. `project` holds its files by path relative to its root ("src/main.c",
 * "makefile"…). Writes each step and its output with `log`. The .8xp is `program`; every file the
 * build made (obj/…, bin/…) is in `files`, by path relative to the project.
 */
export async function buildCeProject(project: Map<string, Uint8Array>, log: (text: string, err: boolean) => void,
  /** Variables set on make's command line (NAME=X), which win over the makefile's, as in make. */
  overrides: Record<string, string> = {}): Promise<CeBuildResult> {
  const makefile = [...project.entries()].find(([p]) => /^(gnu)?makefile$/i.test(p))?.[1];
  const v = { ...makefileVars(makefile ? new TextDecoder().decode(makefile) : ""), ...overrides };
  const yes = (name: string, otherwise: boolean) => (v[name] ? v[name].toUpperCase() === "YES" : otherwise);
  const NAME = v.NAME || "DEMO";
  const SRCDIR = v.SRCDIR || "src";
  if (yes("APPLICATION", false)) throw new Unsupported("it's a Flash app (APPLICATION = YES), which builds in the desktop app");
  if (yes("LTO", true)) log("Link-time optimization is off in the browser: each file is compiled on its own, which can make the program a little bigger.\n", false);
  if (v.ICON || v.DESCRIPTION) log("ICON and DESCRIPTION are left out in the browser (they need convimg).\n", false);

  const files: Files = new Map();
  for (const [path, bytes] of await cedevFiles()) files.set(`/cedev/${path}`, bytes);
  for (const [path, bytes] of project) files.set(`/proj/${path}`, bytes);
  const step = async (label: string, tool: Tool, args: string[]) => {
    log(`[${label}]\n`, false);
    const { code, made } = await run(tool, args, files, log);
    for (const [path, bytes] of made) files.set(path, bytes);
    if (code !== 0) throw Object.assign(new Error(`${label} failed (${tool} exited with ${code}).`), { quiet: true });
  };

  const C = "/cedev";
  const llvm = ["-fno-autolink", "-fno-addrsig", "-fno-threadsafe-statics", "-fno-aligned-allocation", "-mllvm", "-profile-guided-section-prefix=false",
    "-mllvm", "-z80-gas-style", "-ffunction-sections", "-fdata-sections", ...(yes("HAS_MATH_ERRNO", false) ? [] : ["-fno-math-errno"])];
  const common = ["--target=ez80", "-nostdinc", "-Xclang", "-fforce-mangle-main-argc-argv", ...llvm, "-D__TICE__=1"];
  const cIncludes = ["-isystem", `${C}/include`, `-I${SRCDIR}`];
  const cflags = [...common, ...cIncludes, ...words(v.CFLAGS ?? "-Wall -Wextra -Oz")];
  const cxxflags = [...common, "-isystem", `${C}/include/c++`, ...cIncludes, "-fno-exceptions", "-fno-use-cxa-atexit", ...words(v.CXXFLAGS ?? "-Wall -Wextra -Oz")];
  const asflags = ["-march=ez80+full", ...words(v.ASFLAGS ?? "")];

  const sources = [...project.keys()].filter(p => p.startsWith(`${SRCDIR}/`)).sort();
  const objects: string[] = [];
  try {
    for (const src of sources) {
      const obj = `obj/${src.slice(SRCDIR.length + 1)}`;
      if (/\.(c)$/.test(src) || /\.(cpp|cc|cxx)$/.test(src)) {
        const cxx = !src.endsWith(".c");
        await step(`compiling] [${src}`, "clang", ["-S", ...(cxx ? cxxflags : cflags), src, "-o", `${obj}.s`]);
        await step(`assembling] [${src}`, "as", [...asflags, `/proj/${obj}.s`, "-o", `/proj/${obj}.o`]);
        objects.push(`${obj}.o`);
      } else if (src.endsWith(".s")) {
        await step(`assembling] [${src}`, "as", [...asflags, `/proj/${src}`, "-o", `/proj/${obj}.o`]);
        objects.push(`${obj}.o`);
      } else if (src.endsWith(".S")) {
        await step(`preprocessing] [${src}`, "clang", [...cflags, "-E", src, "-o", `${obj}.s`]);
        await step(`assembling] [${src}`, "as", [...asflags, `/proj/${obj}.s`, "-o", `/proj/${obj}.o`]);
        objects.push(`${obj}.o`);
      }
    }
    if (!objects.length) throw new Error(`There's nothing to build in ${SRCDIR}/: no .c, .cpp, .s or .S files.`);

    const lib = (p: string) => `${C}/lib/${p}`;
    const printf = yes("HAS_PRINTF", true);
    const allocator = (v.ALLOCATOR || "STANDARD").toUpperCase();
    const libCrt = lib(yes("PREFER_OS_CRT", false) ? "crt/libcrt_os.a" : "crt/libcrt.a");
    const libC = lib(yes("PREFER_OS_LIBC", true) ? "libc/libc_os.a" : "libc/libc.a");
    const libCxx = yes("HAS_LIBCXX", true) ? [lib("libcxx/libcxx.a")] : [];
    const group = [libCrt, lib("ce/libce.a"), lib("softfloat/libsoftfloat.a"), libC, ...libCxx];

    await step("linking", "ld", ["-i", "-static", "--entry=__start", "--build-id=none", "--no-warn-execstack", "--gc-sections", "--omagic", "--defsym", "__TICE__=1",
      ...(allocator === "CUSTOM" ? ["--undefined", "_malloc", "--undefined", "_free", "--undefined", "_realloc"] : []),
      ...(printf ? [] : ["--defsym", "_sprintf=0x0000BC"]),
      ...objects,
      ...(printf ? ["--whole-archive", lib("libc/libnanoprintf.a"), "--no-whole-archive"] : []),
      "--start-group", ...group, "--end-group", "-o", `obj/${NAME}.o`]);
    await step("stripping", "objcopy", ["--strip-unneeded", `obj/${NAME}.o`]);
    const libload = [...files.keys()].filter(p => p.startsWith(`${C}/lib/libload/`) && p.endsWith(".lib") && !p.endsWith("/libload.lib"));
    await step("libraries", "cedev-obj", ["--elf", `obj/${NAME}.o`, "--output", "obj/crt.h", "--libs", ...libload, "--optional-libs", ...words(v.LIBLOAD_OPTIONAL ?? "")]);
    await step("startup code", "clang", ["--target=ez80", "-Iobj", "-E", "-P", `${C}/lib/crt/crt0.S`, "-o", "obj/crt0.s"]);
    await step("startup code", "as", ["-I/proj/obj", "-march=ez80+full", "/proj/obj/crt0.s", "-o", "/proj/obj/crt0.o"]);
    await step("linking", "ld", ["-static", "--entry=__start", "--no-warn-rwx-segments", "--gc-sections", "--omagic",
      `--defsym=LOAD_ADDR=${hex(v.LOAD_ADDR || "D1A87F")}`, `--defsym=BSSHEAP_LOW=${hex(v.BSSHEAP_LOW || "D052C6")}`,
      `--defsym=BSSHEAP_HIGH=${hex(v.BSSHEAP_HIGH || "D13FD8")}`, `--defsym=STACK_HIGH=${hex(v.STACK_HIGH || "D1A87E")}`,
      "--defsym", "__TICE__=1", `-T${C}/meta/linker_script.ld`, ...words(v.EXTRA_LDFLAGS ?? ""),
      `obj/${NAME}.o`, "obj/crt0.o", "--start-group", ...(allocator === "STANDARD" ? [lib("libc/allocator_standard.a")] : allocator === "SIMPLE" ? [lib("libc/allocator_simple.a")] : []),
      ...group, "--end-group", "-o", `bin/${NAME}.obj`]);
    const compressed = yes("COMPRESSED", false);
    await step("converting", "convbin", [...(yes("ARCHIVED", true) ? ["-r"] : []),
      ...(compressed ? ["-e", v.COMPRESSED_MODE || "zx7", "-k", "8xp-compressed"] : ["-k", "8xp"]),
      ...(yes("HAS_UPPERCASE_NAME", true) ? ["-u"] : []), "-b", v.COMMENT || "CE C Toolchain v15.0 (TIde web)",
      "-n", NAME, "-j", "elf", "-i", `bin/${NAME}.obj`, "-o", `bin/${NAME}.8xp`]);
  } catch (err) {
    if (!(err as { quiet?: boolean }).quiet) log(`${err instanceof Error ? err.message : err}\n`, true);
    return { ok: false, name: NAME, files: relative(files) };
  }
  return { ok: true, name: NAME, program: files.get(`/proj/bin/${NAME}.8xp`), files: relative(files) };
}

/** The files the build made, by path relative to the project. */
function relative(files: Files): Files {
  const out: Files = new Map();
  for (const [path, bytes] of files) if (/^\/proj\/(obj|bin)\//.test(path)) out.set(path.slice(6), bytes);
  return out;
}
