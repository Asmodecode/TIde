// py2ez80 problems from the catalog (PY_LIBRARY), alongside the language checks in py2ez80-support:
// - graphics., math. or random. with a name the module doesn't have (with "did you mean");
// - a module used without being imported (with a quick fix that imports it);
// - a library call with the wrong number of arguments.
import * as monaco from "monaco-editor/editor/editor.api.js";
import { PY_LIBRARY, maskPy, type PyFn } from "./py2ez80-support";
import { replaceFix, closest, watchLanguage } from "./lint";

const OWNER = "tide-py-catalog";
const FNS = new Map<string, PyFn>(PY_LIBRARY.flatMap(g => g.entries.map(e => [e.name, e] as const)));
const MEMBERS: Record<string, string[]> = {};
for (const name of FNS.keys()) {
  const [mod, member] = name.split(".");
  if (member) (MEMBERS[mod] ??= []).push(member);
}

function check(model: monaco.editor.ITextModel): monaco.editor.IMarkerData[] {
  const lines = model.getLinesContent();
  const markers: monaco.editor.IMarkerData[] = [];
  const imported = new Set(lines.flatMap(l => {
    const m = /^\s*import\s+([\w\s,]+)/.exec(l) ?? /^\s*from\s+(\w+)\s+import\b/.exec(l);
    return m ? m[1].split(",").map(s => s.trim().split(/\s+/)[0]) : [];
  }));
  const warnedImport = new Set<string>();
  lines.forEach((raw, i) => {
    const code = maskPy(raw);
    if (/^\s*(import|from)\b/.test(code)) return;
    for (const m of code.matchAll(/\b(graphics|math|random)\.([A-Za-z_]\w*)/g)) {
      const [, mod, member] = m;
      const col = m.index! + 1;
      if (!imported.has(mod) && !warnedImport.has(mod)) {
        warnedImport.add(mod);
        markers.push({ startLineNumber: i + 1, startColumn: col, endLineNumber: i + 1, endColumn: col + mod.length,
          severity: monaco.MarkerSeverity.Error, source: "py2ez80", code: `import:${mod}`, message: `${mod} isn't imported. Add import ${mod} at the top.` });
      }
      if (MEMBERS[mod]?.includes(member)) continue;
      const meant = closest(member, MEMBERS[mod] ?? [], 2);
      const start = col + mod.length + 1;
      markers.push({ startLineNumber: i + 1, startColumn: start, endLineNumber: i + 1, endColumn: start + member.length,
        severity: monaco.MarkerSeverity.Error, source: "py2ez80", code: meant ? `meant:${meant}` : undefined,
        message: `py2ez80's ${mod} module has no ${member}.${meant ? ` Did you mean ${meant}?` : ""}` });
    }
    // Argument counts, for functions whose signature is fixed (not print's "…" or range's [start,]).
    for (const m of code.matchAll(/\b((?:graphics|math|random)\.)?([A-Za-z_]\w*)\s*\(/g)) {
      const fn = FNS.get((m[1] ?? "") + m[2]);
      if (!fn || /[[…]/.test(fn.sig) || /^\s*def\b/.test(code)) continue;
      const open = m.index! + m[0].length - 1;
      let depth = 0, commas = 0, any = false, close = -1;
      for (let j = open; j < code.length; j++) {
        const c = code[j];
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) { if (--depth === 0) { close = j; break; } }
        else if (depth === 1) { if (c === ",") commas++; else if (c.trim()) any = true; }
      }
      if (close < 0) continue; // still being typed
      const count = any ? commas + 1 : 0;
      if (count === fn.params.length) continue;
      markers.push({ startLineNumber: i + 1, startColumn: m.index! + 1, endLineNumber: i + 1, endColumn: close + 2,
        severity: monaco.MarkerSeverity.Error, source: "py2ez80",
        message: `${fn.name} takes ${fn.params.length} argument${fn.params.length === 1 ? "" : "s"}, not ${count}: ${fn.sig}` });
    }
  });
  return markers;
}

export function registerPyChecks(): monaco.IDisposable[] {
  return [
    watchLanguage("python", OWNER, check),
    monaco.languages.registerCodeActionProvider("python", {
      provideCodeActions(model, _range, context) {
        const actions: monaco.languages.CodeAction[] = [];
        for (const m of context.markers.filter(x => x.source === "py2ez80" && typeof x.code === "string")) {
          const code = m.code as string;
          if (code.startsWith("meant:")) actions.push(replaceFix(model, m, `Change to ${code.slice(6)}`, code.slice(6)));
          else if (code.startsWith("import:")) {
            const mod = code.slice(7);
            actions.push({ title: `Add import ${mod}`, kind: "quickfix", diagnostics: [m], isPreferred: true,
              edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: new monaco.Range(1, 1, 1, 1), text: `import ${mod}\n` } }] } });
          }
        }
        return { actions, dispose() {} };
      },
    }, { providedCodeActionKinds: ["quickfix"] }),
  ];
}
