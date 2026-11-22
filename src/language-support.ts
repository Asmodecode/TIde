// TIde's own IntelliSense for each language: completions, hover help, signature help, go to label,
// folding, and assembly highlighting. Extensions turn it on with tide.languages.builtIn(id); the
// bundled CE Languages extension does that for all four, so uninstalling it turns them off.
import * as monaco from "monaco-editor/editor/editor.api.js";
import { registerIntellisense } from "./intellisense";
import { registerC } from "./c-support";
import { registerPy2ez80 } from "./py2ez80-support";
import { registerAsm } from "./asm-support";
import { registerCChecks } from "./c-check";
import { registerAsmChecks } from "./asm-check";
import { registerPyChecks } from "./py-check";

/** The languages with built-in support, by id. Each one's registration. It may return more to dispose: checks, quick fixes, the outline. */
export const BUILT_IN_LANGUAGES: Record<string, () => void | monaco.IDisposable[]> = {
  tibasic: () => { registerIntellisense(); return [basicOutline()]; },
  c: () => { registerC(); return registerCChecks(); },
  ez80: () => { registerAsm(); return registerAsmChecks(); },
  python: () => { registerPy2ez80(); return registerPyChecks(); },
};

/** TI-BASIC's labels in the outline (Ctrl+Shift+O), to jump between parts of a program. */
function basicOutline(): monaco.IDisposable {
  return monaco.languages.registerDocumentSymbolProvider("tibasic", {
    provideDocumentSymbols(model) {
      const symbols: monaco.languages.DocumentSymbol[] = [];
      model.getLinesContent().forEach((line, i) => {
        const m = /^(\s*:?\s*)Lbl\s+([A-Z0-9θ]{1,2})/.exec(line);
        if (!m) return;
        const start = m[1].length + 1;
        const range = new monaco.Range(i + 1, start, i + 1, start + m[0].length - m[1].length);
        symbols.push({ name: `Lbl ${m[2]}`, detail: "", kind: monaco.languages.SymbolKind.Key, tags: [], range, selectionRange: range });
      });
      return symbols;
    },
  });
}

/**
 * Runs `register` and returns what it registered with Monaco, so it can be undone. The language
 * modules register their providers directly; this collects them without changing those modules.
 */
function collect(register: () => void | monaco.IDisposable[]): monaco.IDisposable[] {
  const languages = monaco.languages as unknown as Record<string, (...args: unknown[]) => monaco.IDisposable>;
  const names = ["registerCompletionItemProvider", "registerHoverProvider", "registerSignatureHelpProvider", "registerDefinitionProvider",
    "registerFoldingRangeProvider", "setMonarchTokensProvider", "setLanguageConfiguration"];
  const originals = names.map(n => languages[n]);
  const got: monaco.IDisposable[] = [];
  names.forEach((n, i) => { languages[n] = (...args) => { const d = originals[i].apply(monaco.languages, args); got.push(d); return d; }; });
  try {
    for (const d of register() ?? []) if (!got.includes(d)) got.push(d);
  } finally { names.forEach((n, i) => { languages[n] = originals[i]; }); }
  return got;
}

/** Turns on TIde's own support for a language. Returns what to dispose to turn it off. */
export function builtInLanguage(id: string): monaco.IDisposable {
  const register = BUILT_IN_LANGUAGES[id];
  if (!register) throw new Error(`TIde has no built-in support for "${id}". It has ${Object.keys(BUILT_IN_LANGUAGES).join(", ")}.`);
  const got = collect(register);
  return { dispose: () => { for (const d of got) d.dispose(); } };
}
