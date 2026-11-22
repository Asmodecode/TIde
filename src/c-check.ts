// IntelliSense for CE C from the library catalog (C_LIBRARY): signature help while typing a call,
// hover tips that say which header a function is in, and problems as you type:
// - a library call with the wrong number of arguments (an error);
// - a library function whose header isn't included (a warning, with a quick fix that adds it);
// - a near-miss of a library function's name (a warning, with "did you mean" as a quick fix).
// Plus the file's functions in the outline (Ctrl+Shift+O).
import * as monaco from "monaco-editor/editor/editor.api.js";
import { C_LIBRARY, type LibFn } from "./c-support";
import { closest, replaceFix, watchLanguage } from "./lint";

const OWNER = "tide-c";

/** The header each library's functions are declared in. The OS functions are spread over several. */
const HEADERS: Record<string, string> = {
  graphx: "graphx.h", fontlibc: "fontlibc.h", fileioc: "fileioc.h", keypadc: "keypadc.h", lcddrvce: "lcddrvce.h",
  usbdrvce: "usbdrvce.h", srldrvce: "srldrvce.h", msddrvce: "msddrvce.h", fatdrvce: "fatdrvce.h", libload: "libload.h",
};

interface Fn extends LibFn { header: string | null; library: string; params: string[]; variadic: boolean }

/** The parameters in a signature, split at its top-level commas (a function-pointer parameter has its own). */
function parameters(sig: string): string[] {
  const open = sig.indexOf("("), close = sig.lastIndexOf(")");
  const inside = sig.slice(open + 1, close).trim();
  if (!inside || inside === "void") return [];
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < inside.length; i++) {
    const c = inside[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { out.push(inside.slice(start, i).trim()); start = i + 1; }
  }
  out.push(inside.slice(start).trim());
  return out;
}

const FNS = new Map<string, Fn>(C_LIBRARY.flatMap(g => {
  const library = g.group.split(" ")[0];
  return g.entries.map(e => {
    const params = parameters(e.sig);
    const variadic = params[params.length - 1] === "...";
    return [e.name, { ...e, library, header: HEADERS[library] ?? null, params: variadic ? params.slice(0, -1) : params, variadic }] as const;
  });
}));
const NAMES = [...FNS.keys()];
/** Prefixes of the libraries' names: a call starting with one is checked for typos. */
const PREFIXES = /^(gfx|fontlib|ti|kb|usb|srl|msd|fat|lcd|os|boot|libload)_/i;
const KEYWORDS = new Set(["if", "while", "for", "switch", "return", "sizeof", "do", "else", "case", "defined", "_Static_assert"]);

/** The code with comments and string and character literals blanked out, keeping every position. */
function mask(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, m => m.replace(/[^\n]/g, " "));
}

/** From an opening parenthesis, the closing one and the arguments' count. Null if it isn't closed. */
function callArgs(code: string, open: number): { close: number; count: number } | null {
  let depth = 0, commas = 0, any = false;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return { close: i, count: any ? commas + 1 : 0 };
    } else if (depth === 1) {
      if (c === ",") commas++;
      else if (!/\s/.test(c)) any = true;
    }
    if (c === ";" && depth > 0) return null; // an unfinished call, still being typed
  }
  return null;
}

function check(model: monaco.editor.ITextModel): monaco.editor.IMarkerData[] {
  const text = model.getValue(), code = mask(text);
  const included = new Set([...text.matchAll(/#\s*include\s*[<"]([^>"]+)[>"]/g)].map(m => m[1].trim()));
  const markers: monaco.editor.IMarkerData[] = [];
  const at = (offset: number) => model.getPositionAt(offset);
  const missing = new Set<string>();
  for (const m of code.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const name = m[1], start = m.index!, open = start + m[0].length - 1;
    if (KEYWORDS.has(name)) continue;
    const s = at(start), e = at(start + name.length);
    const range = { startLineNumber: s.lineNumber, startColumn: s.column, endLineNumber: e.lineNumber, endColumn: e.column };
    const fn = FNS.get(name);
    if (!fn) {
      if (!PREFIXES.test(name)) continue;
      const meant = closest(name, NAMES);
      // A function of the file's own (a definition or prototype: a type before it on its line) isn't a typo.
      const line = model.getLineContent(s.lineNumber).slice(0, s.column - 1);
      if (meant && !/[A-Za-z_]\w*[\s*]+$/.test(line)) {
        markers.push({ ...range, severity: monaco.MarkerSeverity.Warning, message: `${name} isn't a CE library function. Did you mean ${meant}?`, source: "CE C", code: `meant:${meant}` });
      }
      continue;
    }
    // Once per header: the first call that needs it.
    if (fn.header && !included.has(fn.header) && !missing.has(fn.header)) {
      missing.add(fn.header);
      markers.push({ ...range, severity: monaco.MarkerSeverity.Warning, message: `${name} is in ${fn.header}, which isn't included.`, source: "CE C", code: `include:${fn.header}` });
    }
    const args = callArgs(code, open);
    if (!args) continue;
    const want = fn.params.length;
    if (fn.variadic ? args.count < want : args.count !== want) {
      const c = at(args.close + 1);
      markers.push({
        startLineNumber: s.lineNumber, startColumn: s.column, endLineNumber: c.lineNumber, endColumn: c.column,
        severity: monaco.MarkerSeverity.Error, source: "CE C",
        message: `${name} takes ${fn.variadic ? "at least " : ""}${want} argument${want === 1 ? "" : "s"}, not ${args.count}: ${fn.sig}`,
      });
    }
  }
  return markers;
}

/** The call the cursor is in: the function's name, and which argument the cursor is on. */
function callAt(model: monaco.editor.ITextModel, position: monaco.Position): { fn: Fn; arg: number } | null {
  const offset = model.getOffsetAt(position);
  const code = mask(model.getValue()).slice(Math.max(0, offset - 2000), offset);
  let depth = 0, commas = 0;
  for (let i = code.length - 1; i >= 0; i--) {
    const c = code[i];
    if (c === ")" || c === "]" || c === "}") depth++;
    else if (c === "(" || c === "[" || c === "{") {
      if (depth > 0) { depth--; continue; }
      if (c !== "(") return null;
      const name = /([A-Za-z_]\w*)\s*$/.exec(code.slice(0, i))?.[1];
      const fn = name ? FNS.get(name) : undefined;
      return fn ? { fn, arg: commas } : null;
    } else if (c === "," && depth === 0) commas++;
    else if (c === ";" && depth === 0) return null;
  }
  return null;
}

export function registerCChecks(): monaco.IDisposable[] {
  return [
    watchLanguage("c", OWNER, check),
    monaco.languages.registerSignatureHelpProvider("c", {
      signatureHelpTriggerCharacters: ["(", ","],
      signatureHelpRetriggerCharacters: [")"],
      provideSignatureHelp(model, position) {
        const call = callAt(model, position);
        if (!call) return null;
        const { fn } = call;
        const params = [...fn.params, ...(fn.variadic ? ["..."] : [])];
        return {
          value: {
            signatures: [{ label: fn.sig, documentation: { value: `${fn.doc}${fn.header ? `\n\nIn \`${fn.header}\`.` : ""}` }, parameters: params.map(p => ({ label: p })) }],
            activeSignature: 0,
            activeParameter: Math.min(call.arg, params.length - 1),
          },
          dispose() {},
        };
      },
    }),
    monaco.languages.registerHoverProvider("c", {
      provideHover(model, position) {
        const word = model.getWordAtPosition(position);
        const fn = word && FNS.get(word.word);
        if (!fn) return null;
        // The library's own hover shows the signature and doc; this adds where it's from.
        return { contents: [{ value: fn.header ? `From **${fn.library}**: \`#include <${fn.header}>\`` : `From the CE toolchain's **${fn.library}** headers.` }] };
      },
    }),
    monaco.languages.registerCodeActionProvider("c", {
      provideCodeActions(model, _range, context) {
        const actions: monaco.languages.CodeAction[] = [];
        for (const marker of context.markers.filter(m => m.source === "CE C" && typeof m.code === "string")) {
          const code = marker.code as string;
          if (code.startsWith("meant:")) {
            const name = code.slice(6);
            actions.push(replaceFix(model, marker, `Change to ${name}`, name));
          } else if (code.startsWith("include:")) {
            const header = code.slice(8);
            // After the last #include, or at the top.
            const lines = model.getLinesContent();
            let line = 0;
            lines.forEach((l, i) => { if (/^\s*#\s*include\b/.test(l)) line = i + 1; });
            actions.push({
              title: `Add #include <${header}>`, kind: "quickfix", diagnostics: [marker], isPreferred: true,
              edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: new monaco.Range(line + 1, 1, line + 1, 1), text: `#include <${header}>\n` } }] },
            });
          }
        }
        return { actions, dispose() {} };
      },
    }, { providedCodeActionKinds: ["quickfix"] }),
    monaco.languages.registerDocumentSymbolProvider("c", {
      provideDocumentSymbols(model) {
        const code = mask(model.getValue());
        const symbols: monaco.languages.DocumentSymbol[] = [];
        // A function definition: a type and a name at the start of a line, its parameters, then "{".
        for (const m of code.matchAll(/^[ \t]*(?:static\s+|inline\s+|extern\s+)*[A-Za-z_][\w\s*]*?\b([A-Za-z_]\w*)\s*\([^;{)]*\)\s*\{/gm)) {
          if (KEYWORDS.has(m[1])) continue;
          const start = model.getPositionAt(m.index!), name = model.getPositionAt(m.index! + m[0].indexOf(m[1]));
          const range = new monaco.Range(start.lineNumber, 1, start.lineNumber, model.getLineMaxColumn(start.lineNumber));
          symbols.push({ name: m[1], detail: "", kind: monaco.languages.SymbolKind.Function, tags: [], range,
            selectionRange: new monaco.Range(name.lineNumber, name.column, name.lineNumber, name.column + m[1].length) });
        }
        return symbols;
      },
    }),
  ];
}
