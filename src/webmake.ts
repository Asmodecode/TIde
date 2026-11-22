// The web version's build line: what .tide/tide.json's "build" says, run in the browser. There's no
// shell there, so this reads the line itself: commands joined with && run one after another, each
// only if the one before it worked, as in a shell. Each must be make, which is the CE toolchain's,
// compiled to WebAssembly (cebuild.ts):
//   make                  builds the program in the project (or -C folder), as its makefile would;
//   make -C folder        the same in that folder ("make -C mods/dunes");
//   make clean            removes bin/ and obj/;
//   make NAME=X …         sets a makefile variable, as make does;
//   -j4, -s, -B, V=1 …    are taken and ignored (they don't change what's built).
// A makefile's own rules (appvars: flash-app, all: package…) are followed as make would, from the
// goal through what each needs first: where they reach the CE toolchain's targets (target, all,
// clean), those are built; their own recipes run other tools in a shell, so they're left out, and
// the log says which. Anything that isn't make needs the desktop app, which runs the line in a shell.
import { buildCeProject, makefileGraph, Unsupported } from "./cebuild";

export interface WebMakeHost {
  /** The project's files under `dir` ("" for the root), by path relative to it. */
  files(dir: string): Promise<Map<string, Uint8Array>>;
  /** Writes a file the build made, by path relative to the project. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Removes a folder in the project, if it's there. */
  remove(path: string): Promise<void>;
  log(text: string, err: boolean): void;
}

/** Splits a line at &&, outside quotes. Other shell operators (|, ;, ||, >, &) can't run here. */
export function splitAnd(line: string): string[] {
  const parts: string[] = [];
  let at = 0, quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "&" && line[i + 1] === "&") { parts.push(line.slice(at, i)); at = i + 2; i++; continue; }
    if (c === "|" || c === ";" || c === ">" || c === "<" || c === "&" || c === "`" || (c === "$" && line[i + 1] === "(")) {
      throw new Error(`"${line}" uses ${c === "$" ? "$(…)" : c === "&" ? "&" : c}, which only a real shell runs: build it in the desktop app. The web version runs make commands joined with &&.`);
    }
  }
  parts.push(line.slice(at));
  const commands = parts.map(p => p.trim());
  if (commands.some(p => !p)) throw new Error(`"${line}" has an empty command around &&.`);
  return commands;
}

const words = (text: string) => [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]);
/** Flags that don't change what's built, with the ones that take a value next. */
const IGNORED = /^(?:-j\d*|--jobs(?:=\d+)?|-s|--silent|--quiet|-B|--always-make|-k|--keep-going|-w|--no-print-directory|-l\d*)$/;
const TAKES_VALUE = new Set(["-j", "--jobs", "-l"]);

interface MakeCall { dir: string; targets: string[]; vars: Record<string, string> }

function parseMake(command: string): MakeCall {
  const [name, ...args] = words(command);
  if (name !== "make" && name !== "gmake") {
    throw new Error(`"${command}" isn't make, and the web version runs only the CE toolchain's make. Build it in the desktop app, or keep "build" to make commands.`);
  }
  const call: MakeCall = { dir: "", targets: [], vars: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-C" || a === "--directory") { call.dir = joinRel(call.dir, args[++i] ?? ""); continue; }
    const dir = /^(?:-C|--directory=)(.+)$/.exec(a);
    if (dir) { call.dir = joinRel(call.dir, dir[1]); continue; }
    if (IGNORED.test(a)) { if (TAKES_VALUE.has(a) && /^\d+$/.test(args[i + 1] ?? "")) i++; continue; }
    const v = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(a);
    if (v) { if (v[1] !== "V") call.vars[v[1]] = v[2]; continue; }
    if (a.startsWith("-")) throw new Error(`make ${a} isn't one the web version knows. It takes -C, -j, -s, -B and VAR=value.`);
    call.targets.push(a);
  }
  return call;
}

/** A project-relative folder: "mods/dunes", without ./, .. or slashes at the ends. */
function joinRel(base: string, rel: string): string {
  const parts = [...base.split("/"), ...rel.replace(/\\/g, "/").split("/")].filter(p => p && p !== ".");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") { if (!out.length) throw new Error(`make -C ${rel} goes outside the project.`); out.pop(); }
    else out.push(p);
  }
  return out.join("/");
}

const MAKEFILE = /^(?:gnu)?makefile$/i;

/** Runs a build line in the browser. Resolves with whether every command in it worked. */
export async function runWebMake(line: string, host: WebMakeHost): Promise<{ ok: boolean; names: string[]; skipped: string[] }> {
  const commands = splitAnd(line);
  const calls = commands.map(parseMake);
  const names: string[] = [];
  /** What was left out, across every command. */
  const skipped: string[] = [];
  for (const [i, call] of calls.entries()) {
    const where = call.dir || "the project";
    if (commands.length > 1) host.log(`\n▸ ${commands[i]}  (${i + 1} of ${commands.length})\n`, false);
    const prefix = call.dir ? `${call.dir}/` : "";
    const clean = async () => {
      await host.remove(`${prefix}bin`);
      await host.remove(`${prefix}obj`);
      host.log(`Removed bin/ and obj/ in ${where}.\n`, false);
    };
    // A plain make clean needs no makefile.
    if (call.targets.length === 1 && call.targets[0] === "clean") { await clean(); continue; }
    const files = await host.files(call.dir);
    const makefile = [...files.entries()].find(([p]) => MAKEFILE.test(p));
    if (!makefile) { host.log(`There's no makefile in ${where}.\n`, true); return { ok: false, names, skipped }; }
    const graph = makefileGraph(new TextDecoder().decode(makefile[1]));

    // Make's way: from each goal, the rules it needs first, then its own recipe. The CE toolchain's
    // targets (the program, clean) are the browser's make; a recipe of the makefile's own runs
    // other tools in a shell, so it's left out, and said so.
    const left: string[] = [];
    const seen = new Set<string>();
    let built = false;
    const reach = async (target: string): Promise<boolean> => {
      if (seen.has(target)) return true;
      seen.add(target);
      const rule = graph.rules.get(target);
      if (rule) {
        for (const p of rule.prereqs) {
          // A file the makefile has no rule for is a source (or one the toolchain's rules make).
          if (graph.rules.has(p) || TOOLCHAIN.has(p)) { if (!(await reach(p))) return false; }
        }
        if (rule.recipe.length) left.push(`${target} (${tools(rule.recipe)})`);
        return true;
      }
      if (target === "clean") { await clean(); return true; }
      if (PROGRAM.has(target)) {
        if (built) return true;
        built = true;
        try {
          const result = await buildCeProject(files, host.log, call.vars);
          for (const [rel, bytes] of result.files) if (rel.startsWith("bin/")) await host.write(`${prefix}${rel}`, bytes);
          if (!result.ok) return false;
          names.push(`${prefix}bin/${result.name}.8xp`);
        } catch (err) {
          if (!(err instanceof Unsupported)) throw err;
          left.push(`the program: ${err.message}`);
        }
        return true;
      }
      // The toolchain's other targets (gfx, debug…) run tools the browser doesn't have.
      left.push(`${target} (a CE toolchain target the browser can't run)`);
      return true;
    };
    const goals = call.targets.length ? call.targets : [graph.defaultGoal];
    for (const goal of goals) if (!(await reach(goal))) return { ok: false, names, skipped: [...skipped, ...left] };
    if (left.length) {
      host.log(`Left out in ${where}, as they need a shell or the desktop app: ${left.join("; ")}.\n`, false);
      skipped.push(...left.map(l => `${prefix || ""}${l}`));
    }
    if (!built) host.log(`Nothing in ${where} builds in the browser: ${goals.join(", ")} comes down to the makefile's own recipes alone.\n`, false);
  }
  return { ok: true, names, skipped };
}

/** The CE toolchain's targets that build the program. */
const PROGRAM = new Set(["all", "target", "default", "bin", "build"]);
/** The CE toolchain's own targets, which rules of a makefile's own can need (flash-app: target). */
const TOOLCHAIN = new Set([...PROGRAM, "clean", "gfx", "debug"]);
/** The tools a recipe runs, for saying what was left out: "convbin", "python", "make"… */
function tools(recipe: string[]): string {
  // A recipe's first word is the tool, often through a variable: $(CONVBIN) is convbin, $(MAKE) is make.
  // $(call LDLINE,…) is the function it calls.
  const names = recipe.map(line => (/^\$\((?:call\s+)?([\w-]+)/.exec(line)?.[1] ?? line.split(/\s+/)[0]).toLowerCase());
  return [...new Set(names)].slice(0, 3).join(", ");
}
