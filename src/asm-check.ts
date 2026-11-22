// IntelliSense for eZ80 assembly from the catalog (ASM_LIBRARY): problems as you type for a
// misspelled instruction, directive or OS routine (with "did you mean" as a quick fix), go to a
// label's definition (F12), and the file's labels in the outline (Ctrl+Shift+O).
// Only near-misses of catalog names are flagged, so macros and your own names never are.
import * as monaco from "monaco-editor/editor/editor.api.js";
import { ASM_LANG, ASM_LIBRARY } from "./asm-support";
import { closest, replaceFix, watchLanguage } from "./lint";

const OWNER = "tide-asm";
const isRoutineGroup = (g: string) => g.startsWith("TI-OS");
/** Instructions and directives, in lower case. */
const INSTRUCTIONS = new Set(ASM_LIBRARY.filter(g => !isRoutineGroup(g.group) && !g.group.startsWith("Mode")).flatMap(g => g.entries.map(e => e.name.toLowerCase())));
/** OS routines and addresses, as written (_PutS). */
const ROUTINES = new Set(ASM_LIBRARY.filter(g => isRoutineGroup(g.group)).flatMap(g => g.entries.map(e => e.name)));
const LABEL = /^\s*([A-Za-z_.$@?][\w.$@?]*)::?/;

/** A line with its comment and strings blanked out, keeping every position. */
const code = (line: string) => line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, m => " ".repeat(m.length)).replace(/;.*$/, m => " ".repeat(m.length));

function check(model: monaco.editor.ITextModel): monaco.editor.IMarkerData[] {
  const lines = model.getLinesContent();
  const markers: monaco.editor.IMarkerData[] = [];
  // Macros the file defines are instructions too.
  const macros = new Set(lines.flatMap(l => /^\s*(?:macro|struct)\s+([A-Za-z_][\w.]*)/i.exec(l)?.[1].toLowerCase() ?? []));
  lines.forEach((raw, i) => {
    const line = code(raw);
    let rest = line, offset = 0;
    const label = LABEL.exec(line);
    if (label) { offset = label[0].length; rest = line.slice(offset); }
    const word = /^(\s*)([A-Za-z_][\w]*)(\.[A-Za-z]+)?/.exec(rest);
    if (!word) return;
    const name = word[2], start = offset + word[1].length + 1;
    const after = rest.slice(word[0].length);
    // A constant ("name = 5", "name equ 5") or a label without a colon at the line's start isn't an instruction.
    if (/^\s*(=|:=|equ\b|reb\b|rb\b|rw\b|rl\b|\?)/i.test(after) || (!label && word[1] === "" && !INSTRUCTIONS.has(name.toLowerCase()))) return;
    const lower = name.toLowerCase();
    if (!INSTRUCTIONS.has(lower) && !macros.has(lower)) {
      const meant = closest(lower, INSTRUCTIONS);
      if (meant) {
        markers.push({ startLineNumber: i + 1, startColumn: start, endLineNumber: i + 1, endColumn: start + name.length,
          severity: monaco.MarkerSeverity.Warning, source: "eZ80", code: `meant:${meant}`,
          message: `"${name}" isn't an eZ80 instruction or directive. Did you mean ${meant}?` });
      }
      return;
    }
    // OS routines and addresses in the operands: a near-miss of a real one is likely a typo.
    for (const m of after.matchAll(/\b(_[A-Za-z]\w*)/g)) {
      if (ROUTINES.has(m[1])) continue;
      const meant = closest(m[1], ROUTINES);
      if (!meant) continue;
      const col = offset + word[0].length + m.index! + 1;
      markers.push({ startLineNumber: i + 1, startColumn: col, endLineNumber: i + 1, endColumn: col + m[1].length,
        severity: monaco.MarkerSeverity.Warning, source: "eZ80", code: `meant:${meant}`,
        message: `${m[1]} isn't a TI-OS routine or address in ti84pceg.inc. Did you mean ${meant}?` });
    }
  });
  return markers;
}

/** Where each label is defined: its name, line and column. */
function labels(model: monaco.editor.ITextModel) {
  const found: { name: string; line: number; column: number }[] = [];
  model.getLinesContent().forEach((raw, i) => {
    const m = LABEL.exec(code(raw));
    if (m) found.push({ name: m[1], line: i + 1, column: m[0].indexOf(m[1]) + 1 });
  });
  return found;
}

export function registerAsmChecks(): monaco.IDisposable[] {
  return [
    watchLanguage(ASM_LANG, OWNER, check),
    monaco.languages.registerCodeActionProvider(ASM_LANG, {
      provideCodeActions(model, _range, context) {
        const actions = context.markers.filter(m => m.source === "eZ80" && typeof m.code === "string" && m.code.startsWith("meant:"))
          .map(m => { const name = (m.code as string).slice(6); return replaceFix(model, m, `Change to ${name}`, name); });
        return { actions, dispose() {} };
      },
    }, { providedCodeActionKinds: ["quickfix"] }),
    monaco.languages.registerDefinitionProvider(ASM_LANG, {
      provideDefinition(model, position) {
        const word = model.getWordAtPosition(position);
        const label = word && labels(model).find(l => l.name === word.word || l.name.replace(/^\./, "") === word.word);
        return label ? { uri: model.uri, range: new monaco.Range(label.line, label.column, label.line, label.column + label.name.length) } : null;
      },
    }),
    monaco.languages.registerDocumentSymbolProvider(ASM_LANG, {
      provideDocumentSymbols(model) {
        return labels(model).map(l => {
          const range = new monaco.Range(l.line, l.column, l.line, l.column + l.name.length);
          return { name: l.name, detail: "", kind: monaco.languages.SymbolKind.Function, tags: [], range, selectionRange: range };
        });
      },
    }),
  ];
}
