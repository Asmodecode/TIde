// Indentation: how each file indents, Enter indenting the next line, and Format document.
// - A file keeps the indentation it already has (tabs, or spaces in its own steps), as VS Code
//   does. Makefiles always use tabs, since make needs them; assembly lines up with tabs.
// - TI-BASIC can be indented for reading: the calculator has no indentation, so a build leaves it
//   out (build.ts), and nothing ends up in the program.
// - Enter indents after a TI-BASIC block opens and after an assembly label (their language configs,
//   in language.ts and asm-support.ts); C and Python get Monaco's own.
// - Format document (Shift+Alt+F) re-indents a whole file from its blocks: TI-BASIC's Then, Else,
//   For(, While, Repeat and End; C's braces; Python's own levels, evened out; assembly's one tab.
import * as monaco from "monaco-editor/editor/editor.api.js";
import { ASM_LANG } from "./asm-support";

const MAKEFILE = /^(?:gnu)?makefile$|\.mk$/i;

/** Sets a model's tab size and tabs or spaces: what its file already uses, else the defaults. */
export function applyIndentation(model: monaco.editor.ITextModel, fileName: string, language: string, tabSize: number) {
  if (language === ASM_LANG) { model.updateOptions({ tabSize: 8, insertSpaces: false }); return; }
  if (MAKEFILE.test(fileName)) { model.updateOptions({ tabSize, insertSpaces: false }); return; }
  model.updateOptions({ tabSize, insertSpaces: true });
  // Looks at the lines that are indented; with none, the defaults above stay.
  model.detectIndentation(true, tabSize);
}

// ── Splitting lines into code, strings and comments ──

/** TI-BASIC statements on a line: split at ":" outside strings. A string ends at ", → or the line's end. */
function basicStatements(line: string): string[] {
  const out: string[] = [];
  let start = 0, inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inString = !inString;
    else if (c === "→") inString = false;
    else if (c === ":" && !inString) { out.push(line.slice(start, i)); start = i + 1; }
  }
  out.push(line.slice(start));
  return out.map(s => s.trim());
}

const opens = (s: string) => /^(?:Then|Else|For\(|While\b|Repeat\b)/.test(s) && !/^Else\b/.test(s);
const closes = (s: string) => /^End\b/.test(s);

/** How a TI-BASIC line changes the block depth: [before this line, after it]. */
function basicDepth(line: string): { dedent: number; change: number } {
  const statements = basicStatements(line.replace(/^\s*:?/, "")).filter(Boolean);
  let change = 0;
  for (const s of statements) {
    if (opens(s)) change++;
    else if (closes(s)) change--;
  }
  // The line itself sits one level out when it starts by closing a block, or with Else.
  const first = statements[0] ?? "";
  return { dedent: closes(first) || /^Else\b/.test(first) ? 1 : 0, change };
}

function formatBasic(lines: string[], unit: string): string[] {
  let depth = 0;
  return lines.map(raw => {
    const text = raw.trim();
    if (!text) return "";
    const { dedent, change } = basicDepth(text);
    const level = Math.max(0, depth - dedent);
    depth = Math.max(0, depth + change);
    return unit.repeat(level) + text;
  });
}

/** C and C++: braces, outside strings, character literals and comments, set the depth. */
function formatC(lines: string[], unit: string): string[] {
  let depth = 0, parens = 0, inComment = false;
  return lines.map(raw => {
    const text = raw.trim();
    if (!text) return "";
    // Inside a block comment, lines keep lining up with its " *".
    if (inComment) {
      if (text.includes("*/")) inComment = false;
      return unit.repeat(depth) + (text.startsWith("*") ? " " : unit) + text;
    }
    let lead = 0;
    for (const c of text) { if (c === "}") lead++; else break; }
    // Preprocessor lines stay at the margin.
    const level = text.startsWith("#") ? 0 : Math.max(0, depth - lead) + (parens > 0 ? 2 : 0);
    let quote = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inComment) { if (c === "*" && text[i + 1] === "/") { inComment = false; i++; } continue; }
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === "/" && text[i + 1] === "/") break;
      else if (c === "/" && text[i + 1] === "*") { inComment = true; i++; }
      else if (c === "{") depth++;
      else if (c === "}") depth = Math.max(0, depth - 1);
      else if (c === "(") parens++;
      else if (c === ")") parens = Math.max(0, parens - 1);
    }
    if (text.startsWith("#")) return text;
    return unit.repeat(level) + text;
  });
}

/**
 * Python: indentation is the program, so the levels stay as they are and only their spelling
 * changes, to `unit` a level. Lines inside brackets and triple-quoted strings are left alone.
 */
function formatPython(lines: string[], unit: string, tabSize: number): string[] {
  const widths: number[] = [0];
  let brackets = 0, triple = "";
  return lines.map(raw => {
    const text = raw.trimEnd();
    if (!text.trim()) return "";
    const inside = brackets > 0 || !!triple;
    let out = text;
    if (!inside && !text.trimStart().startsWith("#")) {
      const lead = text.length - text.trimStart().length;
      let width = 0;
      for (const c of text.slice(0, lead)) width = c === "\t" ? width + tabSize - (width % tabSize) : width + 1;
      while (widths.length > 1 && width < widths[widths.length - 1]) widths.pop();
      if (width > widths[widths.length - 1]) widths.push(width);
      out = unit.repeat(widths.length - 1) + text.trimStart();
    } else if (!inside) {
      // A comment line goes with the code at its depth, at most one level in.
      const lead = text.length - text.trimStart().length;
      out = unit.repeat(Math.max(0, widths.filter(w => w <= lead).length - 1)) + text.trimStart();
    }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (triple) { if (text.startsWith(triple, i)) { triple = ""; i += 2; } continue; }
      if (c === "#") break;
      if (text.startsWith('"""', i) || text.startsWith("'''", i)) { triple = text.slice(i, i + 3); i += 2; continue; }
      if (c === '"' || c === "'") {
        for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
        continue;
      }
      if ("([{".includes(c)) brackets++;
      else if (")]}".includes(c)) brackets = Math.max(0, brackets - 1);
    }
    return out;
  });
}

/** Assembly: what's at the margin (labels, and anything the assembler reads as one) stays there; the rest gets one tab. */
function formatAsm(lines: string[]): string[] {
  return lines.map(raw => {
    const text = raw.trimEnd();
    if (!text.trim()) return "";
    return /^\s/.test(text) ? "\t" + text.trimStart() : text;
  });
}

function format(model: monaco.editor.ITextModel, options: monaco.languages.FormattingOptions): monaco.languages.TextEdit[] {
  const lines = model.getLinesContent();
  const unit = options.insertSpaces ? " ".repeat(options.tabSize) : "\t";
  const language = model.getLanguageId();
  const out = language === "tibasic" ? formatBasic(lines, unit)
    : language === "python" ? formatPython(lines, unit, options.tabSize)
    : language === ASM_LANG ? formatAsm(lines)
    : formatC(lines, unit);
  const edits: monaco.languages.TextEdit[] = [];
  out.forEach((text, i) => {
    if (text !== lines[i]) edits.push({ range: new monaco.Range(i + 1, 1, i + 1, lines[i].length + 1), text });
  });
  return edits;
}

export function registerIndentation() {
  for (const language of ["tibasic", "c", "cpp", "python", "tipython", ASM_LANG]) {
    monaco.languages.registerDocumentFormattingEditProvider(language, { displayName: "TIde", provideDocumentFormattingEdits: (model, options) => format(model, options) });
  }
}
