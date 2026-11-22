// Helpers for checking code as it's typed: watching a language's files for changes, and finding
// the catalog name a typo was meant to be.
import * as monaco from "monaco-editor/editor/editor.api.js";

/** How many single-letter edits turn a into b, giving up past `max`. */
export function distance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * The name `word` was most likely meant to be: one a letter or two away (case aside), or the same
 * name in the wrong case. Null if there's none, so names that are simply not in the catalog (the
 * user's own, macros) aren't flagged.
 */
export function closest(word: string, names: Iterable<string>, max = word.length > 6 ? 2 : 1): string | null {
  const lower = word.toLowerCase();
  let best: string | null = null, bestScore = max + 1;
  for (const name of names) {
    if (name === word) return null;
    const d = name.toLowerCase() === lower ? 0.5 : distance(lower, name.toLowerCase(), max);
    if (d < bestScore) { best = name; bestScore = d; }
  }
  return best;
}

/**
 * Checks every file of `language`, now and as it's edited, showing what `check` returns as
 * problems. Returns what to dispose to stop and clear them.
 */
export function watchLanguage(language: string, owner: string, check: (model: monaco.editor.ITextModel) => monaco.editor.IMarkerData[]): monaco.IDisposable {
  const watched = new Map<monaco.editor.ITextModel, monaco.IDisposable>();
  const run = (model: monaco.editor.ITextModel) => {
    if (model.isDisposed()) return;
    try { monaco.editor.setModelMarkers(model, owner, check(model)); } catch (err) { console.error(`${owner} check failed`, err); }
  };
  const watch = (model: monaco.editor.ITextModel) => {
    if (watched.has(model) || model.getLanguageId() !== language) return;
    let timer: number | undefined;
    const sub = model.onDidChangeContent(() => { window.clearTimeout(timer); timer = window.setTimeout(() => run(model), 300); });
    watched.set(model, { dispose: () => { window.clearTimeout(timer); sub.dispose(); } });
    run(model);
  };
  const subs = [
    monaco.editor.onDidCreateModel(watch),
    monaco.editor.onDidChangeModelLanguage(e => { if (e.model.getLanguageId() === language) watch(e.model); }),
    monaco.editor.onWillDisposeModel(m => { watched.get(m)?.dispose(); watched.delete(m); }),
  ];
  for (const model of monaco.editor.getModels()) watch(model);
  return {
    dispose() {
      for (const s of subs) s.dispose();
      for (const [model, w] of watched) { w.dispose(); if (!model.isDisposed()) monaco.editor.setModelMarkers(model, owner, []); }
      watched.clear();
    },
  };
}

/** A quick fix that replaces a marker's text, for "did you mean" problems. */
export function replaceFix(model: monaco.editor.ITextModel, marker: monaco.editor.IMarkerData, title: string, text: string): monaco.languages.CodeAction {
  return {
    title, kind: "quickfix", diagnostics: [marker], isPreferred: true,
    edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: marker as monaco.IRange, text } }] },
  };
}
