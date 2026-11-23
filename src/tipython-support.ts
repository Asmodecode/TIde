// TI-Python is the Python App language on the TI-84 Evo and TI-84 Plus CE Python.
// It uses Monaco's Python tokenizer and adds TI module completions and starter programs.
import * as monaco from "monaco-editor/editor/editor.api.js";

export function registerTiPythonLanguage(): void {
  monaco.languages.register({ id: "tipython", aliases: ["TI-Python"], extensions: [".py"] });
  monaco.languages.setMonarchTokensProvider("tipython", {
    tokenizer: { root: [
      [/#.*$/, "comment"],
      [/([rRuUbBfF]|fr|rf|br|rb)?\"\"\"[\s\S]*?\"\"\"/, "string"],
      [/([rRuUbBfF]|fr|rf|br|rb)?("[^"]*"|'[^']*')/, "string"],
      [/\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield)\b/, "keyword"],
      [/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i, "number"],
      [/[a-zA-Z_]\w*/, "identifier"],
      [/[{}()[\],.:;]/, "delimiter"],
      [/[+\-*/%=<>!&|^~]+/, "operator"],
    ] },
  });
  monaco.languages.setLanguageConfiguration("tipython", {
    comments: { lineComment: "#" },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [{ open: "(", close: ")" }, { open: "[", close: "]" }, { open: "{", close: "}" }, { open: "\"", close: "\"" }, { open: "'", close: "'" }],
    indentationRules: { increaseIndentPattern: /^\s*(?:async\s+)?(?:def|class|if|elif|else|for|while|try|except|finally|with)\b.*:\s*$/, decreaseIndentPattern: /^\s*(?:elif|else|except|finally)\b/ },
  });
}

export const TI_PYTHON_SNIPPETS = [
  { label: "hello", doc: "Print a message in the Python App.", body: "print(\"${1:Hello, world!}\")\n$0" },
  { label: "for range", doc: "Count through a range.", body: "for ${1:i} in range(${2:10}):\n    $0" },
  { label: "ti plot", doc: "Start a TI plotLib graph.", body: "import ti_plotlib as plt\n\nplt.cls()\n${1:plt.plot(0, 0)}\nplt.show_plot()\n$0" },
  { label: "ti draw", doc: "Draw text with the TI drawing module.", body: "import ti_draw\n\nti_draw.clear()\nti_draw.draw_text(0, 0, \"${1:Hello}\")\n$0" },
  { label: "ti system", doc: "Use TI calculator system functions.", body: "import ti_system\n\n$0" },
];

export const TI_PYTHON_CATALOG = [
  { group: "Snippets", entries: TI_PYTHON_SNIPPETS.map(s => ({ name: s.label, insert: s.body, hint: s.doc })) },
  { group: "TI modules", entries: [
    { name: "ti_system", insert: "ti_system", hint: "TI calculator system and device functions." },
    { name: "ti_draw", insert: "ti_draw", hint: "Drawing functions for the calculator screen." },
    { name: "ti_plotlib", insert: "ti_plotlib", hint: "Plotting and graphing functions." },
    { name: "ti_hub_module", insert: "ti_hub_module", hint: "TI-Innovator Hub functions." },
    { name: "ti_rover", insert: "ti_rover", hint: "TI-Innovator Rover functions." },
  ] },
];

const MODULES = [
  ["ti_system", "TI calculator system and device functions."],
  ["ti_draw", "Drawing functions for the calculator screen."],
  ["ti_plotlib", "Plotting and graphing functions."],
  ["ti_hub_module", "TI-Innovator Hub functions."],
  ["ti_rover", "TI-Innovator Rover functions."],
  ["math", "Python math functions."],
  ["random", "Python random number functions."],
  ["time", "Time and delay functions."],
] as const;

export function registerTiPython(): monaco.IDisposable[] {
  const ds: monaco.IDisposable[] = [];
  ds.push(monaco.languages.registerCompletionItemProvider("tipython", {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const items = [
        ...MODULES.map(([name, doc]) => ({ label: name, kind: monaco.languages.CompletionItemKind.Module, insertText: name, documentation: doc, range })),
        ...TI_PYTHON_SNIPPETS.map(s => ({ label: s.label, kind: monaco.languages.CompletionItemKind.Snippet, insertText: s.body, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: s.doc, range })),
      ];
      return { suggestions: items };
    },
  }));
  ds.push(monaco.languages.registerHoverProvider("tipython", {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      const found = MODULES.find(([name]) => name === word?.word);
      return found ? { contents: [{ value: `**${found[0]}**` }, { value: found[1] }] } : null;
    },
  }));
  return ds;
}

