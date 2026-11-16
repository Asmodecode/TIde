// The panel under the editor, as in VS Code: Output (every build, prerun, postrun and script run,
// with its full log as it happens) and Terminal (command lines in the system shell). Both show
// colors from ANSI codes, and a progress line that redraws itself with "\r" stays one line.
import type { ShellRun } from "./store";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

// ── A log: text with ANSI colors, "\r" redraws and a cap on its length ──

const COLORS = ["#4b5563", "#f87171", "#86d9a8", "#f5c07a", "#7dd3fc", "#c4b5fd", "#5eead4", "#e3e9f3"];
const BRIGHT = ["#8b9cbb", "#fca5a5", "#bbf7d0", "#fde68a", "#bae6fd", "#ddd6fe", "#99f6e4", "#ffffff"];
const MAX_LINES = 20000;

class Log {
  readonly el: HTMLElement;
  private line: HTMLElement;
  private style = { color: "", bold: false };
  private pendingCR = false;
  private lines = 1;

  constructor(className: string) {
    this.el = el("div", { className });
    this.line = this.newLine();
  }

  private newLine() {
    const line = el("div", { className: "log-line" });
    this.el.append(line);
    this.lines++;
    while (this.lines > MAX_LINES && this.el.firstElementChild) { this.el.firstElementChild.remove(); this.lines--; }
    return line;
  }

  /** Whether the log is scrolled to the end, so new text keeps it there. */
  private get atEnd() { return this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 8; }

  /** Writes program output. `kind` styles all of it: "err" for stderr, "cmd", "ok", "info". */
  write(text: string, kind = "") {
    const follow = this.atEnd;
    // Escape sequences: colors (SGR) are kept, everything else (cursor moves, titles) is dropped.
    const parts = text.split(/(\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r\n|\r|\n)/);
    for (const part of parts) {
      if (!part) continue;
      if (part === "\n" || part === "\r\n") { this.pendingCR = false; this.line = this.newLine(); continue; }
      if (part === "\r") { this.pendingCR = true; continue; }
      if (part.startsWith("\x1b")) {
        const sgr = /^\x1b\[([0-9;]*)m$/.exec(part);
        if (sgr) this.sgr(sgr[1]);
        continue;
      }
      // Text after a lone "\r" replaces the line, as a progress line does in a terminal.
      if (this.pendingCR) { this.line.replaceChildren(); this.pendingCR = false; }
      const span = el("span", { className: kind }, part);
      if (this.style.color) span.style.color = this.style.color;
      if (this.style.bold) span.style.fontWeight = "600";
      this.line.append(span);
    }
    if (follow) this.el.scrollTop = this.el.scrollHeight;
  }

  private sgr(codes: string) {
    for (const n of (codes || "0").split(";").map(Number)) {
      if (n === 0) this.style = { color: "", bold: false };
      else if (n === 1) this.style.bold = true;
      else if (n === 22) this.style.bold = false;
      else if (n >= 30 && n <= 37) this.style.color = COLORS[n - 30];
      else if (n >= 90 && n <= 97) this.style.color = BRIGHT[n - 90];
      else if (n === 39) this.style.color = "";
    }
  }

  /** Writes a whole line of TIde's own, such as a header. */
  note(text: string, kind: string) {
    if (this.line.childNodes.length) this.line = this.newLine();
    this.write(`${text}\n`, kind);
  }

  clear() {
    this.el.replaceChildren();
    this.lines = 0;
    this.line = this.newLine();
  }

  text() { return [...this.el.children].map(l => l.textContent).join("\n"); }
}

export type PanelTab = "output" | "terminal" | "console";

/** One run in the Output tab, from start to finish. */
export interface OutputRun {
  write(text: string, err: boolean): void;
  /** Ends the run: its status line, and its Stop button goes. */
  end(ok: boolean, code: number | null): void;
}

export function createPanel(opts: {
  available: boolean;
  runShell: (dir: string, line: string, onOutput: (text: string, err: boolean) => void) => ShellRun;
  homeDir: () => Promise<string>;
  /** The open folder, where the terminal starts. */
  projectRoot: () => string | null;
  say: (text: string) => void;
  /** Called after the panel opens, closes or changes size, so the editor can fit itself. */
  layout: () => void;
}) {
  const panel = $("panel"), body = $("panel-body");
  const tabs = { output: $<HTMLButtonElement>("panel-tab-output"), terminal: $<HTMLButtonElement>("panel-tab-terminal"), console: $<HTMLButtonElement>("panel-tab-console") };
  const stopButton = $<HTMLButtonElement>("panel-stop"), clearButton = $<HTMLButtonElement>("panel-clear");
  let tab: PanelTab = "output";

  // ── Output ──
  const outputLog = new Log("log output-log");
  let outputStop: (() => void) | null = null;
  const outputPane = el("div", { className: "panel-pane" }, outputLog.el);

  // ── Terminal ──
  const termLog = new Log("log term-log");
  const prompt = el("span", { className: "term-prompt" });
  const input = el("input", { className: "term-input", spellcheck: false, autocomplete: "off", ariaLabel: "Terminal command" });
  const terminalPane = el("div", { className: "panel-pane terminal" }, termLog.el, el("div", { className: "term-line" }, prompt, input));
  let cwd: string | null = null;
  let running: ShellRun | null = null;
  const history: string[] = [];
  let historyAt = 0;
  const WINDOWS = navigator.userAgent.includes("Windows");
  const folderName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
  const showPrompt = () => {
    prompt.textContent = running ? "input ›" : `${cwd ? folderName(cwd) : "…"} ›`;
    input.placeholder = running ? "Type input for the running command, Enter to send" : "Type a command and press Enter";
  };
  /** Moves the terminal to a folder, saying so. */
  function setCwd(dir: string, say = true) {
    cwd = dir;
    if (say) termLog.note(`Now in ${dir}`, "info");
    showPrompt();
  }
  async function ensureCwd() {
    if (!cwd) setCwd(opts.projectRoot() ?? (await opts.homeDir().catch(() => ".")), false);
    return cwd!;
  }

  /** cd runs in the shell too, which checks the folder and prints where it ended up. */
  async function changeDir(target: string) {
    const here = await ensureCwd();
    let where = "";
    const line = WINDOWS ? `cd /d ${target || "%USERPROFILE%"} && cd` : `cd ${target || "~"} && pwd`;
    const run = opts.runShell(here, line, (text, err) => { if (err) termLog.write(text, "err"); else where += text; });
    const code = await run.done.catch(err => { termLog.write(`${err}\n`, "err"); return 1; });
    if (code === 0 && where.trim()) setCwd(where.trim().split(/\r?\n/).pop()!);
  }

  async function submit() {
    const line = input.value;
    input.value = "";
    if (running) {
      // A command is running: the line is its input.
      termLog.write(`${line}\n`, "input");
      await running.input(`${line}\n`).catch(err => termLog.write(`${err}\n`, "err"));
      return;
    }
    const trimmed = line.trim();
    if (trimmed && history[history.length - 1] !== trimmed) history.push(trimmed);
    historyAt = history.length;
    const here = await ensureCwd();
    termLog.note(`${folderName(here)} › ${trimmed}`, "cmd");
    if (!trimmed) return;
    if (/^(clear|cls)$/i.test(trimmed)) { termLog.clear(); return; }
    const cd = /^(?:cd|chdir)(?:\s+(?:\/d\s+)?(.*))?$/i.exec(trimmed);
    if (cd) { await changeDir((cd[1] ?? "").trim()); return; }
    const run = running = opts.runShell(here, trimmed, (text, err) => termLog.write(text, err ? "err" : ""));
    showPrompt();
    updateStop();
    const code = await run.done.catch(err => { termLog.write(`${err}\n`, "err"); return 1; });
    running = null;
    if (code === null) termLog.note("Stopped.", "err");
    else if (code !== 0) termLog.note(`Exited with ${code}.`, "err");
    showPrompt();
    updateStop();
  }
  input.addEventListener("keydown", e => {
    e.stopPropagation(); // TIde's shortcuts stay out of the terminal's way
    if (e.key === "Enter") { e.preventDefault(); void submit(); }
    else if (e.key === "ArrowUp" && !running && history.length) { e.preventDefault(); historyAt = Math.max(0, historyAt - 1); input.value = history[historyAt]; }
    else if (e.key === "ArrowDown" && !running) { e.preventDefault(); historyAt = Math.min(history.length, historyAt + 1); input.value = history[historyAt] ?? ""; }
    else if (e.key === "c" && e.ctrlKey && running && !input.selectionEnd) { e.preventDefault(); void running.stop(); }
    else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); termLog.clear(); }
  });
  terminalPane.addEventListener("click", () => { if (!getSelection()?.toString()) input.focus(); });

  // ── Console: the calculator's output (dbg_printf from C programs, emulator messages), as under the calculator ──
  const consoleLog = new Log("log console-log");
  const consolePane = el("div", { className: "panel-pane" }, consoleLog.el);

  // ── The panel ──
  body.replaceChildren(outputPane, terminalPane, consolePane);
  const HEIGHT = "tide-pref-panel-height";
  let height = 240;
  try { height = Number(localStorage.getItem(HEIGHT)) || 240; } catch { /* storage unavailable */ }
  // `height` is the size you chose; it's fitted to the window each time the panel shows, so a small
  // window (or one not laid out yet) doesn't shrink what's remembered.
  const fitHeight = () => {
    panel.style.height = `${Math.round(Math.max(90, Math.min(height, Math.max(200, window.innerHeight - 160))))}px`;
    opts.layout();
  };
  const setHeight = (h: number) => { height = Math.max(90, h); fitHeight(); };
  window.addEventListener("resize", () => { if (!panel.hidden) fitHeight(); });

  function updateStop() {
    const can = tab === "output" ? !!outputStop : tab === "terminal" && !!running;
    stopButton.hidden = !can;
  }
  /** The status bar's Terminal and Output buttons show which tab is open. */
  function markButtons() {
    for (const k of ["terminal", "output"] as const) {
      document.getElementById(`status-${k}`)?.setAttribute("aria-pressed", String(!panel.hidden && tab === k));
    }
  }
  function select(next: PanelTab) {
    tab = next;
    for (const [k, b] of Object.entries(tabs)) b.setAttribute("aria-selected", String(k === next));
    outputPane.hidden = next !== "output";
    terminalPane.hidden = next !== "terminal";
    consolePane.hidden = next !== "console";
    clearButton.title = next === "output" ? "Clear the output" : next === "console" ? "Clear the console" : "Clear the terminal (Ctrl+L)";
    updateStop();
    markButtons();
  }
  function show(next: PanelTab, focus = false) {
    const opening = panel.hidden;
    panel.hidden = false;
    select(next);
    if (opening) fitHeight();
    if (next === "terminal") {
      void ensureCwd().then(showPrompt);
      if (!opts.available) termLog.note("The terminal needs the desktop app.", "err");
    }
    if (focus && next === "terminal") input.focus();
  }
  function hide() { panel.hidden = true; opts.layout(); markButtons(); }

  tabs.output.addEventListener("click", () => select("output"));
  const toggle = (next: PanelTab) => { if (!panel.hidden && tab === next) hide(); else show(next, true); };
  document.getElementById("status-terminal")?.addEventListener("click", () => toggle("terminal"));
  document.getElementById("status-output")?.addEventListener("click", () => toggle("output"));
  tabs.terminal.addEventListener("click", () => { select("terminal"); input.focus(); });
  clearButton.addEventListener("click", () => ({ output: outputLog, terminal: termLog, console: consoleLog })[tab].clear());
  tabs.console.addEventListener("click", () => select("console"));
  stopButton.addEventListener("click", () => { if (tab === "output") outputStop?.(); else void running?.stop(); });
  $("panel-close").addEventListener("click", hide);
  // Drag the top edge to resize.
  $("panel-resize").addEventListener("pointerdown", e => {
    e.preventDefault();
    const startY = e.clientY, startH = panel.getBoundingClientRect().height;
    const move = (m: PointerEvent) => setHeight(startH + startY - m.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try { localStorage.setItem(HEIGHT, String(height)); } catch { /* storage unavailable */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  select("output");
  showPrompt();

  return {
    show,
    hide,
    /** Opens the tab, or closes the panel if that tab is already showing. */
    toggle,
    get visible() { return !panel.hidden; },
    /** Writes a line of TIde's own to Output. */
    output(text: string, kind: "cmd" | "ok" | "err" | "info" | "" = "") { outputLog.note(text, kind); },
    /** Starts a run in Output: a header now, its output as it comes, its result at the end. */
    outputRun(label: string, line: string, stop: () => void): OutputRun {
      const started = performance.now();
      outputLog.note(`▶ ${label}: ${line}   (${new Date().toLocaleTimeString()})`, "cmd");
      outputStop = stop;
      updateStop();
      return {
        write: (text, err) => outputLog.write(text, err ? "err" : ""),
        end: (ok, code) => {
          const time = `${((performance.now() - started) / 1000).toFixed(1)} s`;
          outputLog.note(ok ? `✓ ${label} finished in ${time}.` : code === null ? `■ ${label} was stopped after ${time}.` : `✗ ${label} failed with exit code ${code} after ${time}.`, ok ? "ok" : "err");
          outputStop = null;
          updateStop();
        },
      };
    },
    /** The terminal moves to a newly opened folder, unless a command is running in it. */
    projectChanged(root: string | null) {
      if (root && !running) setCwd(root, cwd !== null);
    },
    outputText: () => outputLog.text(),
    /** Writes a line from the calculator's console. */
    console(text: string, kind: "out" | "err" | "info" | "emu") {
      consoleLog.note(text, kind === "err" ? "err" : kind === "out" ? "" : "info");
    },
  };
}
