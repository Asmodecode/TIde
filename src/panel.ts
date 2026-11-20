// The panel under the editor, as in VS Code: Output (every build, prerun, postrun and script run,
// with its full log as it happens), Terminal (your shell, in xterm.js) and Console (the calculator's).
// Output and Console show colors from ANSI codes, and a progress line that redraws itself with "\r"
// stays one line.
import { createTerminal } from "./terminal";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

// ── A log: text with ANSI colors, "\r" redraws and a cap on its length ──

// The theme's ANSI colors (style.css), so text already written changes with dark and light mode.
const COLORS = Array.from({ length: 8 }, (_, i) => `var(--ansi-${i})`);
const BRIGHT = Array.from({ length: 8 }, (_, i) => `var(--ansi-${i + 8})`);
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
  const newTerminal = $<HTMLButtonElement>("panel-new-terminal");
  let tab: PanelTab = "output";

  // ── Output ──
  const outputLog = new Log("log output-log");
  let outputStop: (() => void) | null = null;
  const outputPane = el("div", { className: "panel-pane" }, outputLog.el);

  // ── Terminal: xterm.js on a real shell (terminal.ts) ──
  const terminal = createTerminal({
    desktop: opts.available,
    startDir: async () => opts.projectRoot() ?? (await opts.homeDir().catch(() => ".")),
  });
  const terminalPane = el("div", { className: "panel-pane terminal" }, terminal.el);

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
    stopButton.hidden = !(tab === "output" && outputStop);
    newTerminal.hidden = tab !== "terminal" || !opts.available;
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
    clearButton.title = next === "output" ? "Clear the output" : next === "console" ? "Clear the console" : "Clear the terminal's scrollback";
    if (next === "terminal") terminal.show();
    updateStop();
    markButtons();
  }
  function show(next: PanelTab, focus = false) {
    const opening = panel.hidden;
    panel.hidden = false;
    select(next);
    if (opening) fitHeight();
    if (focus && next === "terminal") requestAnimationFrame(() => terminal.focus());
  }
  function hide() { panel.hidden = true; opts.layout(); markButtons(); }

  tabs.output.addEventListener("click", () => select("output"));
  const toggle = (next: PanelTab) => { if (!panel.hidden && tab === next) hide(); else show(next, true); };
  document.getElementById("status-terminal")?.addEventListener("click", () => toggle("terminal"));
  document.getElementById("status-output")?.addEventListener("click", () => toggle("output"));
  tabs.terminal.addEventListener("click", () => { select("terminal"); terminal.focus(); });
  clearButton.addEventListener("click", () => (tab === "terminal" ? terminal : { output: outputLog, console: consoleLog }[tab]).clear());
  newTerminal.addEventListener("click", () => { terminal.restart(opts.projectRoot() ?? undefined); terminal.focus(); });
  tabs.console.addEventListener("click", () => select("console"));
  stopButton.addEventListener("click", () => outputStop?.());
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
    /** A shell not started yet starts in a newly opened folder; one already running stays where it is (New terminal starts one there). */
    projectChanged(_root: string | null) {},
    outputText: () => outputLog.text(),
    /** Writes a line from the calculator's console. */
    console(text: string, kind: "out" | "err" | "info" | "emu") {
      consoleLog.note(text, kind === "err" ? "err" : kind === "out" ? "" : "info");
    },
  };
}
