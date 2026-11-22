// The calculator panel. Three emulator cores, compiled to WebAssembly and built into TIde, run here:
// - CEmu's (WebCEmu) for the TI-84 Plus CE, which sends over the emulated USB link and launches
//   programs the way CEmu's --launch does;
// - Wabbitemu's (WabbitEmu) for the TI-73, 81, 82, 83, 83 Plus, 83 Plus SE, 84 Plus, 84 Plus SE, 85
//   and 86, which runs a frame at a time on TIde's timer and sends files over its link at once;
// - Firebird's (firebird) for the TI-Nspire CX, which boots from a boot1 and flash image, runs a step
//   at a time on TIde's timer, and sends files over its emulated USB link.
// The model menu on the calculator bar picks one: the CE, the Nspire, or any ROM you've added for the
// others. All draw to the same canvas and share one keypad, relabelled for the TI-85 and 86 and the
// Nspire.
import { invoke } from "@tauri-apps/api/core";
import { connect, type Connected, type USBDeviceLike } from "./link";
import { DbusLink, detectModel, modelFamily } from "./dbus";
import { describeDevice } from "./evo";
import { chooseConnection } from "./connections";
import { openSerialPort } from "./serial";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

/** Every TI file a calculator can receive. Bundles (.b84, .b83) are zips of 8x files. */
export const SEND_TYPES = [
  "8xp",
  "8xv",
  "8xl",
  "8xn",
  "8xm",
  "8xy",
  "8xg",
  "8xs",
  "8xd",
  "8xw",
  "8xc",
  "8xz",
  "8xt",
  "8ca",
  "8cg",
  "8ci",
  "8ek",
  "8xk",
  "8eu",
  "8pu",
  "8yu",
  "b84",
  "b83",
  "73p",
  "73l",
  "73n",
  "73g",
  "73k",
  "82p",
  "82l",
  "82n",
  "82m",
  "82g",
  "83p",
  "83l",
  "83n",
  "83m",
  "83g",
  "85p",
  "85s",
  "85l",
  "85n",
  "85m",
  "85g",
  "86p",
  "86s",
  "86l",
  "86n",
  "86m",
  "86g",
  "85b",
  "86b",
  "82b",
  "83b",
  "tns",
  "tno",
  "tnc",
];
const BUNDLE = /\.b8[34]$/i;
const SENDABLE = new RegExp(`\\.(?:${SEND_TYPES.join("|")})$`, "i");

export interface TiFile {
  name: string;
  bytes: Uint8Array;
}

/** The drag data of files and folders dragged from the Explorer: their paths, one per line. */
export const TREE_DRAG = "application/x-tide-paths";

/**
 * A copy of a TI variable file with every variable marked as archived, and its checksum updated.
 * The calculator only takes groups into archive memory ("file must be archived"), and many .8xg
 * files, clibs.8xg among them, are saved with the flag off.
 */
function archived(file: Uint8Array): Uint8Array {
  const out = file.slice();
  const view = new DataView(out.buffer);
  const end = out.length - 2; // the last two bytes are the checksum
  for (let at = 55; at + 17 <= end;) {
    // entries follow the 55-byte file header
    const headerLen = view.getUint16(at, true),
      dataLen = view.getUint16(at + 2, true);
    if (headerLen === 13) out[at + 14] = 0x80; // the flag byte, after type, name and version
    at += 2 + headerLen + 2 + dataLen;
  }
  let sum = 0;
  for (let i = 55; i < end; i++) sum = (sum + out[i]) & 0xffff;
  view.setUint16(end, sum, true);
  return out;
}

/** The files inside a bundle (a zip): stored or deflated entries, unpacked with the browser's own inflater. */
export async function unbundle(bundle: TiFile): Promise<TiFile[]> {
  const b = bundle.bytes,
    view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let end = b.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--; // end of central directory
  if (end < 0) throw new Error(`${bundle.name} isn't a valid bundle.`);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: TiFile[] = [];
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(at + 10, true),
      size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true),
      comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder()
      .decode(b.subarray(at + 46, at + 46 + nameLen))
      .split("/")
      .pop()!;
    at += 46 + nameLen + extra + comment;
    if (!SENDABLE.test(name) || BUNDLE.test(name)) continue; // skips the bundle's metadata
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    const data = b.subarray(start, start + size);
    if (method === 0) out.push({ name, bytes: data.slice() });
    else if (method === 8) {
      const inflated = new Blob([data as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      out.push({
        name,
        bytes: new Uint8Array(await new Response(inflated).arrayBuffer()),
      });
    } else
      throw new Error(
        `${name} in ${bundle.name} uses an unsupported compression.`,
      );
  }
  return out;
}

interface WebCEmu {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    unlink(path: string): void;
  };
  callMain(args: string[]): void;
  ccall(
    name: string,
    ret: string | null,
    types: string[],
    args: unknown[],
  ): unknown;
  _lcd_get_frame(): number;
  _emu_keypad_event(row: number, col: number, press: number): void;
  _emu_reset(): void;
  _sendKey(key: number): number;
  /** Emscripten's main loop controls. */
  pauseMainLoop?(): void;
}
interface WabbitEmu {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    unlink(path: string): void;
  };
  ccall(
    name: string,
    ret: string | null,
    types: string[],
    args: unknown[],
  ): unknown;
  UTF8ToString(ptr: number): string;
  HEAPU8: Uint8Array;
  _wabbit_fps(): number;
  _wabbit_frame(): void;
  _wabbit_lcd(): number;
  _wabbit_lcd_width(): number;
  _wabbit_lcd_on(): number;
  _wabbit_key(group: number, bit: number, down: number): void;
  _wabbit_reset(): void;
  _wabbit_programs(): number;
}
interface FirebirdEmu {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
    mkdirTree(path: string): void;
  };
  ccall(
    name: string,
    ret: string | null,
    types: string[],
    args: unknown[],
  ): unknown;
  callMain?(args?: string[]): void;
  HEAPU8: Uint8Array;
  canvas?: HTMLCanvasElement;
  _malloc(size: number): number;
  _free?(ptr: number): void;
  _main?(argc?: number, argv?: number): number;
  _paintLCD?(ptr: number): void;
  _fb_start?(): number;
  _fb_step?(): void;
  _fb_paint?(ptr: number): void;
  _fb_key?(row: number, col: number, down: number): void;
  _fb_touch?(x: number, y: number, contact: number, down: number): void;
  _fb_reset?(): void;
  _fb_send?(localPtr: number, remotePtr: number): void;
  _fb_flash_dirty?(): number;
  _fb_save_flash?(): number;
}

type Factory<T> = (options: Record<string, unknown>) => Promise<T>;

/** Wabbitemu's model numbers, as names. */
const WABBIT_MODELS = [
  "TI-81",
  "TI-82",
  "TI-83",
  "TI-85",
  "TI-86",
  "TI-73",
  "TI-83 Plus",
  "TI-83 Plus SE",
  "TI-84 Plus",
  "TI-84 Plus SE",
];
const TI_85 = 3,
  TI_86 = 4,
  TI_83P = 6;

/**
 * A key: label, position and optional keyboard keys. Positions are the CE's keypad matrix (group
 * and bit); the other models use the same layout, with group 7 − row, so one keypad serves all.
 */
interface Key {
  label: string;
  row: number;
  col: number;
  kbd?: string[];
  cls?: string;
}
const k = (
  label: string,
  row: number,
  col: number,
  kbd?: string[],
  cls?: string,
): Key => ({ label, row, col, kbd, cls });
// Keyboard bindings are CEmu's default keymap (gui/qt/keypad/keymap.cpp): letters press the key that
// types them with alpha (A is math, B is apps…), so names can be typed as on the calculator.
const KEYPAD: Key[][] = [
  [
    k("y=", 1, 4, ["F1"], "fn"),
    k("window", 1, 3, ["F2"], "fn"),
    k("zoom", 1, 2, ["F3"], "fn"),
    k("trace", 1, 1, ["F4"], "fn"),
    k("graph", 1, 0, ["F5"], "fn"),
  ],
  [
    k("2nd", 1, 5, ["Tab", ";"], "second"),
    k("mode", 1, 6, ["Home", "Backspace"]),
    k("del", 1, 7, ["Delete", "Insert"]),
  ],
  [
    k("alpha", 2, 7, ["'"], "alpha"),
    k("X,T,θ,n", 3, 7, ["_"]),
    k("stat", 4, 7, ["End"]),
  ],
  [
    k("math", 2, 6, ["=", "a"]),
    k("apps", 3, 6, ["PageUp", "b"]),
    k("prgm", 4, 6, ["PageDown", "c"]),
    k("vars", 5, 6, ["<", "|"]),
    k("clear", 6, 6, ["Escape"]),
  ],
  [
    k("x⁻¹", 2, 5, ["\\", "d"]),
    k("sin", 3, 5, ["$", "e"]),
    k("cos", 4, 5, ["%", "f"]),
    k("tan", 5, 5, ["&", "g"]),
    k("^", 6, 5, ["^", "h"]),
  ],
  [
    k("x²", 2, 4, ["@", "i"]),
    k(",", 3, 4, [",", "j"]),
    k("(", 4, 4, ["(", "{", "k"]),
    k(")", 5, 4, [")", "}", "l"]),
    k("÷", 6, 4, ["/", "m"], "op"),
  ],
  [
    k("log", 2, 3, ["!", "n"]),
    k("7", 3, 3, ["7", "o"], "num"),
    k("8", 4, 3, ["8", "p"], "num"),
    k("9", 5, 3, ["9", "q"], "num"),
    k("×", 6, 3, ["*", "[", "r"], "op"),
  ],
  [
    k("ln", 2, 2, ["`", "s"]),
    k("4", 3, 2, ["4", "t"], "num"),
    k("5", 4, 2, ["5", "u"], "num"),
    k("6", 5, 2, ["6", "v"], "num"),
    k("−", 6, 2, ["-", "]", "w"], "op"),
  ],
  [
    k("sto→", 2, 1, [">", "x"]),
    k("1", 3, 1, ["1", "y"], "num"),
    k("2", 4, 1, ["2", "z"], "num"),
    k("3", 5, 1, ["3", "#"], "num"),
    k("+", 6, 1, ["+", '"'], "op"),
  ],
  [
    k("on", 2, 0, ["F12"]),
    k("0", 3, 0, ["0", " "], "num"),
    k(".", 4, 0, [".", ":"], "num"),
    k("(−)", 5, 0, ["~", "?"], "num"),
    k("enter", 6, 0, ["Enter"], "op"),
  ],
];
const ARROWS: Key[] = [
  k("▲", 7, 3, ["ArrowUp"]),
  k("◀", 7, 1, ["ArrowLeft"]),
  k("▶", 7, 2, ["ArrowRight"]),
  k("▼", 7, 0, ["ArrowDown"]),
];

// The TI-85 and 86 have the same matrix with other labels, and their letters on other keys.
const RELABEL_86: Record<string, [string, string[]]> = {
  "y=": ["F1", ["F1"]],
  window: ["F2", ["F2"]],
  zoom: ["F3", ["F3"]],
  trace: ["F4", ["F4"]],
  graph: ["F5", ["F5"]],
  mode: ["exit", ["Escape", "Home"]],
  del: ["more", ["End", "PageDown"]],
  "X,T,θ,n": ["x-var", ["_", "="]],
  stat: ["del", ["Delete", "Backspace"]],
  math: ["graph", ["Insert"]],
  apps: ["stat", ["PageUp"]],
  prgm: ["prgm", []],
  vars: ["custom", ["|"]],
  clear: ["clear", ["\\"]],
  "x⁻¹": ["log", ["!", "a"]],
  sin: ["sin", ["$", "b"]],
  cos: ["cos", ["%", "c"]],
  tan: ["tan", ["&", "d"]],
  "^": ["^", ["^", "e"]],
  "x²": ["ln", ["`", "f"]],
  ",": ["EE", ["g"]],
  "(": ["(", ["(", "{", "h"]],
  ")": [")", [")", "}", "i"]],
  "÷": ["÷", ["/", "j"]],
  log: ["x²", ["@", "k"]],
  "7": ["7", ["7", "l"]],
  "8": ["8", ["8", "m"]],
  "9": ["9", ["9", "n"]],
  "×": ["×", ["*", "[", "o"]],
  ln: [",", [",", "p"]],
  "4": ["4", ["4", "q"]],
  "5": ["5", ["5", "r"]],
  "6": ["6", ["6", "s"]],
  "−": ["−", ["-", "]", "t"]],
  "sto→": ["sto→", [">"]],
  "1": ["1", ["1", "u"]],
  "2": ["2", ["2", "v"]],
  "3": ["3", ["3", "w"]],
  "+": ["+", ["+", "x"]],
  "0": ["0", ["0", "y"]],
  ".": [".", [".", "z"]],
  "(−)": ["(−)", ["~", " "]],
};
const KEYPAD_86: Key[][] = KEYPAD.map((row) =>
  row.map((key) => {
    const [label, kbd] = RELABEL_86[key.label] ?? [key.label, key.kbd ?? []];
    return {
      ...key,
      label,
      kbd:
        key.label === "2nd" ||
        key.label === "alpha" ||
        key.label === "on" ||
        key.label === "enter"
          ? key.kbd
          : kbd,
    };
  }),
);

// The TI-Nspire CX keypad, in the physical order of the keys. Positions are Firebird's keypad
// matrix (row 0–7, column 0–10, as in firebird's keymap.h), so the engine can pass them straight
// to fb_key; row 8 is the touchpad. Letters type directly (the Nspire has letter keys), so each
// gets its own key on the keyboard.
const KEYPAD_NS: Key[][] = [
  [
    k("doc", 6, 3, ["PageUp"]),
    k("menu", 6, 5, ["PageDown"]),
    k("esc", 6, 7, ["Escape"]),
    k("tab", 6, 9, ["Tab"]),
    k("on", 0, 9, ["F12"], "second"),
  ],
  [
    k("shift", 7, 8, ["Shift"], "second"),
    k("var", 5, 1, ["Insert"], "alpha"),
    k("7", 3, 7, ["7"], "num"),
    k("8", 6, 6, ["8"], "num"),
    k("9", 3, 3, ["9"], "num"),
    k("pad", 5, 10),
  ],
  [
    k("ctrl", 7, 9, ["Control"], "second"),
    k("del", 5, 9, ["Backspace", "Delete"]),
    k("4", 2, 7, ["4"], "num"),
    k("5", 5, 6, ["5"], "num"),
    k("6", 2, 3, ["6"], "num"),
  ],
  [
    k("1", 1, 7, ["1"], "num"),
    k("2", 6, 4, ["2"], "num"),
    k("3", 1, 3, ["3"], "num"),
    k("0", 0, 7, ["0"], "num"),
    k(".", 5, 4, ["."], "num"),
    k("(−)", 0, 3, ["~"], "num"),
  ],
  [
    k("EE", 2, 8),
    k("A", 4, 6, ["a"]),
    k("B", 4, 5, ["b"]),
    k("C", 4, 4, ["c"]),
    k("D", 4, 2, ["d"]),
    k("E", 4, 1, ["e"]),
    k("F", 4, 0, ["f"]),
    k("G", 3, 6, ["g"]),
  ],
  [
    k("H", 3, 5, ["h"]),
    k("I", 3, 4, ["i"]),
    k("J", 3, 2, ["j"]),
    k("K", 3, 1, ["k"]),
    k("L", 3, 0, ["l"]),
    k("M", 2, 6, ["m"]),
    k("N", 2, 5, ["n"]),
    k("?!", 0, 8, ["?"], "fn"),
    k("π", 1, 8, [], "fn"),
  ],
  [
    k("O", 2, 4, ["o"]),
    k("P", 2, 2, ["p"]),
    k("Q", 2, 1, ["q"]),
    k("R", 2, 0, ["r"]),
    k("S", 1, 6, ["s"]),
    k("T", 1, 5, ["t"]),
    k("U", 1, 4, ["u"]),
    k(",", 7, 10, [","]),
    k("↵", 0, 0),
  ],
  [
    k("V", 1, 2, ["v"]),
    k("W", 1, 1, ["w"]),
    k("X", 1, 0, ["x"]),
    k("Y", 0, 6, ["y"]),
    k("Z", 0, 5, ["z"]),
    k("space", 0, 4, [" "]),
  ],
  [
    k("=", 4, 7, ["="], "op"),
    k("trig", 1, 9),
    k("^", 4, 9, ["^"], "op"),
    k("x²", 2, 9),
    k("eˣ", 3, 9),
    k("10ˣ", 1, 10),
    k("(", 5, 5, ["("], "op"),
    k(")", 5, 3, [")"], "op"),
  ],
  [
    k("metrix", 5, 8),
    k("cat", 5, 7),
    k("×", 4, 8, ["*"], "op"),
    k("÷", 3, 8, ["/"], "op"),
    k("+", 6, 2, ["+"], "op"),
    k("−", 5, 2, ["-"], "op"),
    k("enter", 0, 1, ["Enter"], "op"),
    k("flag", 6, 0),
  ],
];
// The Nspire's touchpad, as direction keys plus a click; row 8 tells the engine to use fb_touch.
const ARROWS_NS: Key[] = [
  k("▲", 8, 0, ["ArrowUp"]),
  k("◀", 8, 1, ["ArrowLeft"]),
  k("▶", 8, 2, ["ArrowRight"]),
  k("▼", 8, 3, ["ArrowDown"]),
  k("⬤", 8, 4),
];

interface Layout {
  keypad: Key[][];
  arrows: Key[];
  byKbd: Map<string, Key>;
  macro: Map<string, Key>;
}
function layout(keypad: Key[][], arrows: Key[] = ARROWS): Layout {
  const all = [...keypad.flat(), ...arrows];
  const byLabel = (label: string) =>
    all.find((key) => key.label.toLowerCase() === label);
  const aliases: [string, string][] = [
    ["yequ", "y="],
    ["sto", "sto→"],
    ["store", "sto→"],
    ["x^2", "x²"],
    ["square", "x²"],
    ["x^-1", "x⁻¹"],
    ["inverse", "x⁻¹"],
    ["neg", "(−)"],
    ["negative", "(−)"],
    ["-", "−"],
    ["*", "×"],
    ["/", "÷"],
    ["xtθn", "x,t,θ,n"],
    ["xton", "x,t,θ,n"],
    ["power", "^"],
    ["second", "2nd"],
    ["delete", "del"],
    ["up", "▲"],
    ["left", "◀"],
    ["right", "▶"],
    ["down", "▼"],
    ["f1", "f1"],
    ["f2", "f2"],
    ["f3", "f3"],
    ["f4", "f4"],
    ["f5", "f5"],
    ["xvar", "x-var"],
    ["return", "enter"],
    ["escape", "esc"],
    ["click", "⬤"],
  ];
  return {
    keypad,
    arrows,
    byKbd: new Map(
      all.flatMap((key) => (key.kbd ?? []).map((name) => [name, key] as const)),
    ),
    macro: new Map([
      ...all.map((key) => [key.label.toLowerCase(), key] as [string, Key]),
      ...aliases.flatMap(([alias, label]) => {
        const key = byLabel(label);
        return key ? [[alias, key] as [string, Key]] : [];
      }),
    ]),
  };
}
const LAYOUT_CE = layout(KEYPAD),
  LAYOUT_86 = layout(KEYPAD_86),
  LAYOUT_NS = layout(KEYPAD_NS, ARROWS_NS);

/** How a binding reads in a tooltip. */
const keyName = (name: string) =>
  name === " "
    ? "Space"
    : name.length === 1
      ? name.toUpperCase()
      : name.replace(/^Page/, "Page ");

/** CE OS key codes used to launch a program, as CEmu's --launch does: clear, prgm, the name, enter. */
const KEY_ENTER = 0x05,
  KEY_CLEAR = 0x09,
  KEY_PRGM = 0xda;
const letterKey = (c: string) =>
  /[0-9]/.test(c)
    ? 0x8e + +c
    : /[A-Z]/.test(c)
      ? 0x9a + c.charCodeAt(0) - 65
      : c === "θ"
        ? 0xcc
        : 0;

/** A running emulator: the CE's (CEmu), another model's (Wabbitemu) or the Nspire's (Firebird). */
interface Engine {
  kind: "cemu" | "wabbit" | "firebird" | "usb" | "serial";
  /** The model's name, such as "TI-84 Plus". */
  model: string;
  /** "ce", "plus" (a TI-83 Plus or 84 Plus, which runs .8xp programs), "nspire" or "other". */
  family: "ce" | "plus" | "nspire" | "other";
  layout: Layout;
  /** The screen's size in pixels. */
  width: number;
  height: number;
  /** Copies the screen into `image`. Returns false while the screen is off. */
  frame(image: ImageData): boolean;
  key(key: Key, down: boolean): void;
  send(file: TiFile, label: string): Promise<void>;
  reset(): void;
  stop(): void;
  /** Starts a program by name, from the home screen. */
  launch(name: string): Promise<void>;
  /** Types text, as key.type does. */
  type(text: string): Promise<void>;
  /** Opens an app by name, as app.open does. */
  openApp(name: string): Promise<void>;
  /** Presses a key by name, as key.press does, where the engine does it itself (a real calculator). */
  press?(name: string): Promise<void>;
}

export interface Calc {
  /** Opens the panel; starts the emulator if its ROM is in place. */
  show(): Promise<void>;
  hide(): void;
  readonly visible: boolean;
  /** Whether the console under the calculator is shown. */
  consoleShown: boolean;
  /** Which kind of calculator is running, starting it if needed: null when it isn't set up. */
  family(): Promise<"ce" | "plus" | "nspire" | "other" | null>;
  /** Sends programs to the calculator and launches `launch` once they arrive. */
  /** Libraries (like clibs.8xg) are sent once per calculator session, before the programs. */
  run(files: TiFile[], launch: string, libs?: TiFile[]): Promise<void>;
  /** Runs a calculator macro from tide.json, such as key.press(enter). */
  macro(name: string, arg: string): Promise<void>;
  /** Sends any TI files, unpacking bundles. */
  send(files: TiFile[]): Promise<void>;
  /** The open project's "link" settings from tide.json: which cable it uses. */
  setLink(
    link: { via?: "usb" | "serial"; port?: string; model?: string } | undefined,
  ): void;
  /** Opens the connections popup and connects what's picked (switching to the real calculator). */
  connectReal(): Promise<void>;
  /** Ends the real calculator's connection. */
  disconnectReal(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** A real calculator rather than an emulator: a menu choice or an engine's kind. */
const isReal = (kind: string) =>
  kind === "real" || kind === "usb" || kind === "serial";

export function createCalc(opts: {
  say: (text: string) => void;
  pickRom: (label: string, extensions: string[]) => Promise<string | null>;
  pickFiles: () => Promise<string[]>;
  readFile: (path: string) => Promise<Uint8Array>;
  layout: () => void;
  /** A serial cable connected, for the Serial tab to show and send over. */
  serialConnected?: (link: DbusLink, portName: string) => void;
  /** The serial cable's connection ended. */
  serialDropped?: () => void;
  /** Gets every console line, for the Console tab in the panel under the editor. */
  onLog?: (text: string, kind: "out" | "err" | "info" | "emu") => void;
}): Calc {
  const ui = {
    panel: $("calc"),
    model: $<HTMLSelectElement>("calc-model"),
    state: $("calc-state"),
    setup: $("calc-setup"),
    setupText: $("calc-setup-text"),
    rom: $<HTMLButtonElement>("calc-rom"),
    connect: $<HTMLButtonElement>("calc-connect"),
    disconnect: $<HTMLButtonElement>("calc-disconnect"),
    screen: $("calc-screen"),
    lcd: $<HTMLCanvasElement>("calc-lcd"),
    area: $("calc-lcd-area"),
    send: $<HTMLButtonElement>("calc-send"),
    drop: $("calc-drop"),
    keypad: $("calc-keypad"),
    reset: $<HTMLButtonElement>("calc-reset"),
    reload: $<HTMLButtonElement>("calc-reload"),
    close: $<HTMLButtonElement>("calc-close"),
    consoleToggle: $<HTMLButtonElement>("calc-console-toggle"),
    console: $("calc-console"),
    log: $("calc-console-log"),
    consoleClear: $<HTMLButtonElement>("calc-console-clear"),
  };

  // ── Console: the emulator's output (dbg_printf from C programs, emulator messages) and TIde's own steps ──
  const CONSOLE_PREF = "tide-pref-calc-console"; // not "tide:", which the browser store treats as a program
  function log(text: string, kind: "out" | "err" | "info" | "emu" = "out") {
    opts.onLog?.(text, kind);
    if (!ui.log) return;
    const atEnd =
      ui.log.scrollTop + ui.log.clientHeight >= ui.log.scrollHeight - 4;
    const line = document.createElement("div");
    line.className = `line ${kind}`;
    line.textContent = text;
    ui.log.append(line);
    while (ui.log.childElementCount > 2000) ui.log.firstElementChild!.remove();
    if (atEnd) ui.log.scrollTop = ui.log.scrollHeight;
  }
  /** Status bar and console. */
  const say = (text: string) => {
    opts.say(text);
    log(text, "info");
  };
  function showConsole(on: boolean) {
    if (ui.console) ui.console.hidden = !on;
    ui.consoleToggle.setAttribute("aria-pressed", String(on));
    try {
      localStorage.setItem(CONSOLE_PREF, on ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    if (on && ui.log) ui.log.scrollTop = ui.log.scrollHeight;
  }
  let consoleOpen = true;
  try {
    consoleOpen = localStorage.getItem(CONSOLE_PREF) !== "0";
  } catch {
    /* storage unavailable */
  }
  showConsole(consoleOpen);
  ui.consoleToggle.addEventListener("click", () => {
    consoleOpen = !consoleOpen;
    showConsole(consoleOpen);
  });
  ui.consoleClear?.addEventListener("click", () => ui.log?.replaceChildren());

  let engine: Engine | null = null;
  let starting: Promise<boolean> | null = null;
  let drawing = false;
  // Firebird reports file-transfer progress through this global (its bridge calls it from C).
  let fbProgress: ((p: number) => void) | null = null;
  (window as unknown as Record<string, unknown>).tideFbProgress = (p: number) =>
    fbProgress?.(p);
  /** Saves the Nspire's flash image back to TIde's data folder, in chunks (invoke args are JSON). */
  async function saveNspireFlash(bytes: Uint8Array) {
    const CHUNK = 4 * 1024 * 1024;
    for (let at = 0; at < bytes.length; at += CHUNK) {
      const end = Math.min(at + CHUNK, bytes.length);
      await invoke("calc_nspire_flash_write", {
        offset: at,
        bytes: Array.from(bytes.subarray(at, end)),
      });
    }
  }
  // Libraries already on the calculator since it started, by name and size.
  const sentLibs = new Set<string>();

  // ── Screen ──
  // The emulator's frame goes to a small canvas the screen's own size, is blown up with hard pixel
  // edges to a whole multiple at least as large as it's shown, and the browser scales that down
  // smoothly. The LCD fills the room it has and stays sharp at any size.
  const frame = document.createElement("canvas");
  let fctx = frame.getContext("2d")!;
  let image = fctx.createImageData(320, 240);
  const ctx = ui.lcd.getContext("2d")!;
  const body = ui.screen;
  function setScreenSize(width: number, height: number) {
    if (frame.width === width && frame.height === height) return;
    frame.width = width;
    frame.height = height;
    fctx = frame.getContext("2d")!;
    image = fctx.createImageData(width, height);
    fit();
  }
  // The screen and the keypad are two panes of the same size: side by side when there is room,
  // stacked when the editor area is narrow. Each pane is as large as the space allows.
  const GAP = 24,
    BEZEL = 28;
  function fit() {
    if (ui.panel.hidden) return;
    const dpr = window.devicePixelRatio || 1;
    const style = getComputedStyle(body);
    const w =
      body.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    const h =
      body.clientHeight -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom);
    const stacked = w < 680;
    const paneW = stacked ? w : (w - GAP) / 2;
    const paneH = Math.max(
      260,
      Math.min(
        stacked ? (h - GAP) / 2 : h,
        ((paneW - BEZEL) * 3) / 4 + BEZEL,
        760,
      ),
    );
    const innerW = Math.floor(((paneH - BEZEL) * 4) / 3),
      innerH = Math.floor(paneH - BEZEL);
    body.classList.toggle("stacked", stacked);
    body.style.setProperty("--pane-w", `${innerW + BEZEL}px`);
    body.style.setProperty("--pane-h", `${Math.floor(paneH)}px`);
    // The screen keeps its own shape (4:3 on the CE, 3:2 or 2:1 on the others) inside the pane.
    const aspect = frame.width / frame.height;
    const cssW = Math.min(innerW, innerH * aspect),
      cssH = cssW / aspect;
    const k = Math.max(2, Math.ceil((cssW * dpr) / frame.width));
    ui.lcd.width = frame.width * k;
    ui.lcd.height = frame.height * k;
    ui.lcd.style.width = `${cssW}px`;
    ui.lcd.style.height = `${cssH}px`;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, 0, 0, ui.lcd.width, ui.lcd.height);
  }
  const resize = new ResizeObserver(fit);
  resize.observe(ui.area);
  resize.observe(body);

  function drawOff(text = "LCD OFF") {
    // As CEmu shows it: a dark screen that says the LCD is off. Also the loading screen, while
    // an emulator core is being read, instantiated and booted (the Nspire's flash alone can be 132 MB).
    ctx.fillStyle = "#101418";
    ctx.fillRect(0, 0, ui.lcd.width, ui.lcd.height);
    ctx.fillStyle = "#8b9cbb";
    ctx.font = `600 ${Math.round(ui.lcd.height / 12)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, ui.lcd.width / 2, ui.lcd.height / 2);
  }

  /** Each animation frame: copy the LCD to the canvas. */
  function draw() {
    if (!engine || isReal(engine.kind)) {
      drawing = false;
      return;
    }
    if (!ui.panel.hidden) {
      setScreenSize(engine.width, engine.height);
      const on = engine.frame(image);
      const state = on ? "running" : "LCD off";
      if (ui.state.textContent !== state) ui.state.textContent = state;
      if (on) {
        fctx.putImageData(image, 0, 0);
        ctx.drawImage(frame, 0, 0, ui.lcd.width, ui.lcd.height);
      } else drawOff();
    }
    requestAnimationFrame(draw);
  }

  // ── Keypad ──
  const press = (key: Key, down: boolean) => engine?.key(key, down);
  /** Presses and releases a key, waiting for the calculator to see both. */
  const tap = async (key: Key, hold = 120, after = 180) => {
    press(key, true);
    await sleep(hold);
    press(key, false);
    await sleep(after);
  };
  let shownLayout: Layout | null = null;
  function buildKeypad(l: Layout) {
    if (shownLayout === l) return;
    shownLayout = l;
    const button = (key: Key) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = key.label;
      b.className = `key ${key.cls ?? ""}`;
      b.title = key.kbd?.length
        ? `${key.label} (${key.kbd.map(keyName).join(" or ")})`
        : key.label;
      const release = () => {
        press(key, false);
        window.removeEventListener("pointerup", release);
      };
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        ui.lcd.focus();
        press(key, true);
        window.addEventListener("pointerup", release);
      });
      return b;
    };
    const arrows = document.createElement("div");
    arrows.className = "arrows";
    arrows.append(...l.arrows.map(button));
    ui.keypad.replaceChildren(
      ...l.keypad.map((row, i) => {
        const div = document.createElement("div");
        div.className = "keyrow";
        div.append(...row.map(button));
        if (i === 1) div.append(arrows); // the arrow pad sits beside 2nd, mode and del
        return div;
      }),
    );
  }
  buildKeypad(LAYOUT_CE);

  // The physical keyboard drives the calculator while its panel is open, with CEmu's bindings.
  // Keys typed into the editor or a form field still go there. A key is released by its physical
  // position, since Shift can change what it types in between.
  const held = new Map<string, Key>();
  const typingInField = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return (
      !!t &&
      (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    );
  };
  window.addEventListener("keydown", (e) => {
    if (ui.panel.hidden || typingInField(e)) return;
    // Leave TIde's shortcuts alone, but let the Nspire's own ctrl key through.
    if ((e.ctrlKey || e.metaKey || e.altKey) && e.key !== "Control") return;
    const map = (engine?.layout ?? LAYOUT_CE).byKbd;
    const key = map.get(e.key) ?? map.get(e.key.toLowerCase());
    if (!key) return;
    e.preventDefault();
    e.stopPropagation(); // F5 is graph here, not Run
    if (e.repeat || held.has(e.code)) return;
    held.set(e.code, key);
    press(key, true);
  });
  window.addEventListener("keyup", (e) => {
    const key = held.get(e.code);
    if (!key) return;
    e.preventDefault();
    held.delete(e.code);
    press(key, false);
  });
  window.addEventListener("blur", () => {
    for (const key of held.values()) press(key, false);
    held.clear();
  });

  // ── Models and files ──
  type Files = {
    rom: boolean;
    roms: string[];
    nspire: { boot1: boolean; flash: boolean };
  };
  const files = () => invoke<Files>("calc_files");
  const read = async (name: string) =>
    new Uint8Array(await invoke<ArrayBuffer>("calc_read", { name }));
  const MODEL_PREF = "tide-pref-calc-model",
    NAMES_PREF = "tide-pref-calc-rom-models";
  /** "ce", "nspire", "real" (a real calculator), or "rom:" and a stored ROM's file name. */
  let choice = "ce";
  try {
    choice = localStorage.getItem(MODEL_PREF) ?? "ce";
  } catch {
    /* storage unavailable */
  }
  // 1.7.0 had a choice for each cable; one connects them all now.
  if (choice === "usb" || choice === "serial" || choice === "evo")
    choice = "real";
  /** The model each stored ROM turned out to be, for the menu. */
  let romModels: Record<string, string> = {};
  try {
    romModels = JSON.parse(localStorage.getItem(NAMES_PREF) ?? "{}");
  } catch {
    /* storage unavailable or bad JSON */
  }
  function remember(key: string, value: unknown) {
    try {
      localStorage.setItem(
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      );
    } catch {
      /* storage unavailable */
    }
  }

  let known: Files | null = null;
  function fillMenu(have: Files | null) {
    const roms =
      have?.roms ?? (choice.startsWith("rom:") ? [choice.slice(4)] : []);
    const options: [string, string][] = [
      ["ce", "TI-84 Plus CE"],
      ["nspire", "TI-Nspire CX"],
      ...roms.map(
        (n) =>
          [`rom:${n}`, romModels[n] ? `${romModels[n]} (${n})` : n] as [
            string,
            string,
          ],
      ),
    ];
    if (
      choice !== "ce" &&
      choice !== "nspire" &&
      choice !== "real" &&
      !roms.includes(choice.slice(4)) &&
      have
    )
      choice = "ce";
    options.push(["real", "Real calculator"], ["add", "Add a ROM…"]);
    if (choice.startsWith("rom:"))
      options.push(["remove", `Remove ${choice.slice(4)}…`]);
    if (choice === "nspire")
      options.push(["remove-nspire", "Remove Nspire images…"]);
    ui.model.replaceChildren(
      ...options.map(([value, label]) =>
        Object.assign(document.createElement("option"), {
          value,
          textContent: label,
        }),
      ),
    );
    ui.model.value = choice;
  }
  fillMenu(null);

  /** A message in place of the screen, with the button that sets the calculator up, if any. */
  function setup(
    text: string,
    button: "rom" | "connect" | "disconnect" | null,
  ) {
    ui.setup.hidden = !text;
    ui.setupText.textContent = text;
    ui.rom.hidden = button !== "rom";
    ui.connect.hidden = button !== "connect";
    ui.disconnect.hidden = button !== "disconnect";
    ui.screen.hidden = !!text;
    ui.reset.hidden = ui.reload.hidden = isReal(choice);
  }

  async function loadModule<T>(
    script: Uint8Array,
    options: Record<string, unknown>,
  ): Promise<T> {
    const url = URL.createObjectURL(
      new Blob([script as BlobPart], { type: "text/javascript" }),
    );
    try {
      return await (
        (
          await import(/* @vite-ignore */ url)
        ).default as Factory<T>
      )(options);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ── CEmu, for the TI-84 Plus CE ──
  let transfer: {
    resolve: () => void;
    reject: (e: Error) => void;
    progress: (value: number, total: number) => void;
  } | null = null;
  async function startCemu(): Promise<Engine | null> {
    const [script, wasm, rom] = await Promise.all([
      read("WebCEmu.js"),
      read("WebCEmu.wasm"),
      read("CE.rom"),
    ]);
    // The core's main() reports through these globals, as CEmu's own web page defines them.
    const w = window as unknown as Record<string, unknown>;
    let ok = false;
    Object.assign(w, {
      emul_is_inited: false,
      emul_is_paused: false,
      initFuncs: () => {},
      initLCD: () => {},
      enableGUI: () => {
        ok = true;
      },
      disableGUI: () => {
        ok = false;
      },
      // CEmu reports bytes sent out of the total while a transfer runs; that count can reach the total
      // before it is finished (a group sends several variables). The real end comes when the USB
      // transfer closes: (1, 1) when it worked, (0, 0) when it failed.
      transferProgressCallback: (value: number, total: number) => {
        if (!transfer) return;
        if (value === 1 && total === 1) {
          transfer.resolve();
          transfer = null;
        } else if (value === 0 && total === 0) {
          transfer.reject(new Error("The calculator refused the file."));
          transfer = null;
        } else transfer.progress(value, total);
      },
      transferErrorCallback: () => {
        transfer?.reject(new Error("The calculator refused the file."));
        transfer = null;
      },
    });
    let memory: WebAssembly.Memory | null = null;
    const emu = await loadModule<WebCEmu>(script, {
      print: (t: string) => log(t, "out"),
      // CEmu reports its own status on stderr too; only real errors get the warning color.
      printErr: (t: string) =>
        log(
          t,
          /\b(?:error|fail|bad|couldn't|invalid)/i.test(t) ? "err" : "emu",
        ),
      // Instantiate the WebAssembly ourselves to keep its memory, which holds the LCD.
      instantiateWasm(
        imports: WebAssembly.Imports,
        done: (instance: WebAssembly.Instance) => void,
      ) {
        WebAssembly.instantiate(wasm as BufferSource, imports).then(
          ({ instance }) => {
            memory =
              (Object.values(instance.exports).find(
                (e) => e instanceof WebAssembly.Memory,
              ) as WebAssembly.Memory) ?? null;
            done(instance);
          },
        );
        return {};
      },
    });
    emu.FS.writeFile("CE.rom", rom);
    try {
      emu.callMain([]);
    } catch {
      /* main() hands over to the browser's frame loop by throwing */
    }
    if (!ok) return null;
    // Run on a 16 ms timer rather than animation frames, so emulation keeps its speed when the
    // page draws slowly or the window is behind another one. Drawing still follows the frames.
    emu.ccall(
      "emsc_set_main_loop_timing",
      "number",
      ["number", "number"],
      [0, 16],
    );
    // The OS takes one key code at a time; sendKey refuses until it has read the last one.
    const keyQueue: number[] = [];
    const feeding = window.setInterval(() => {
      if (keyQueue.length && emu._sendKey(keyQueue[0])) keyQueue.shift();
    }, 20);
    const typed = async (codes: number[]) => {
      keyQueue.push(...codes);
      for (let i = 0; keyQueue.length && i < 400; i++) await sleep(25);
      await sleep(150);
    };
    // Whether the screen is off. CEmu has no flag for it, but an off or sleeping panel shows one flat
    // grey (the panel's blank level) on every pixel. Full black or white screens are left alone, since
    // programs draw those, and the screen must stay blank for half a second, so a quick clear isn't "off".
    let blankSince = 0;
    const lcdOff = (px: Uint32Array) => {
      const first = px[0],
        rgb = first & 0xffffff;
      let blank =
        rgb !== 0 &&
        rgb !== 0xffffff &&
        (rgb & 0xff) === ((rgb >> 8) & 0xff) &&
        (rgb & 0xff) === rgb >> 16;
      for (let i = 1; blank && i < px.length; i++)
        if (px[i] !== first) blank = false;
      if (!blank) {
        blankSince = 0;
        return false;
      }
      blankSince ||= performance.now();
      return performance.now() - blankSince > 500;
    };
    return {
      kind: "cemu",
      model: "TI-84 Plus CE",
      family: "ce",
      layout: LAYOUT_CE,
      width: 320,
      height: 240,
      frame(out) {
        if (!memory) return true;
        const ptr = emu._lcd_get_frame();
        if (lcdOff(new Uint32Array(memory.buffer, ptr, 320 * 240)))
          return false;
        const src = new Uint8Array(memory.buffer, ptr, 320 * 240 * 4),
          dst = out.data;
        for (let i = 0; i < dst.length; i += 4) {
          // 0x00RRGGBB, little-endian
          dst[i] = src[i + 2];
          dst[i + 1] = src[i + 1];
          dst[i + 2] = src[i];
          dst[i + 3] = 255;
        }
        return true;
      },
      key: (key, down) => emu._emu_keypad_event(key.row, key.col, down ? 1 : 0),
      async send(file, label) {
        const bytes = /\.8xg$/i.test(file.name)
          ? archived(file.bytes)
          : file.bytes;
        const path = `/send.${file.name.split(".").pop()}`;
        emu.FS.writeFile(path, bytes);
        try {
          let timer = 0,
            shown = -1;
          await new Promise<void>((resolve, reject) => {
            // Give up only when the transfer stalls: no progress for 15 seconds. Large apps, groups
            // and OS files keep reporting progress, so they can take as long as they need.
            const stall = () => {
              window.clearTimeout(timer);
              timer = window.setTimeout(() => {
                if (!transfer) return;
                transfer = null;
                reject(
                  new Error(
                    "The calculator stopped taking the file. Is it on the home screen?",
                  ),
                );
              }, 15000);
            };
            transfer = {
              resolve: () => {
                window.clearTimeout(timer);
                resolve();
              },
              reject: (e) => {
                window.clearTimeout(timer);
                reject(e);
              },
              progress: (value, total) => {
                stall();
                const percent = total
                  ? Math.min(99, Math.floor((value / total) * 100))
                  : 0;
                if (percent >= shown + 10) {
                  shown = percent - (percent % 10);
                  opts.say(`${label}… ${shown}%`);
                }
              },
            };
            stall();
            emu.ccall("set_file_to_send", null, ["string"], [path]);
          });
        } finally {
          try {
            emu.FS.unlink(path);
          } catch {
            /* already gone */
          }
        }
      },
      reset: () => emu._emu_reset(),
      stop() {
        window.clearInterval(feeding);
        try {
          emu.pauseMainLoop?.();
        } catch {
          /* already stopped */
        }
        transfer?.reject(new Error("The calculator was stopped."));
        transfer = null;
      },
      launch: (name) =>
        typed([
          KEY_CLEAR,
          KEY_PRGM,
          ...[...name.toUpperCase()].map(letterKey).filter(Boolean),
          KEY_ENTER,
        ]),
      type: (text) =>
        typed([...text.toUpperCase()].map(letterKey).filter(Boolean)),
      async openApp(name) {
        // The apps menu jumps to the first app starting with a letter; Enter opens the selected one.
        await tap(LAYOUT_CE.macro.get("apps")!, 120, 400);
        const first = letterKey(name.charAt(0).toUpperCase());
        if (first) await typed([first]);
        await typed([KEY_ENTER]);
      },
    };
  }

  // ── Wabbitemu, for the TI-73, 81, 82, 83, 83 Plus, 84 Plus, 85 and 86 ──
  const LINK_ERRORS: Record<number, string> = {
    1: "The link failed.",
    2: "The calculator didn't answer in time. Is it on the home screen?",
    3: "The calculator couldn't load the app.",
    4: "The file was damaged on the way.",
    5: "The link wasn't ready.",
    6: "There isn't enough memory on the calculator.",
    7: "That file is for a different calculator.",
    8: "That isn't a TI file this calculator can read.",
    9: "The emulator had a problem.",
  };
  async function startWabbit(name: string): Promise<Engine | null> {
    const [script, wasm, rom] = await Promise.all([
      read("WabbitEmu.js"),
      read("WabbitEmu.wasm"),
      read(`roms/${name}`),
    ]);
    const emu = await loadModule<WabbitEmu>(script, {
      wasmBinary: wasm,
      locateFile: (file: string) => file, // the script is a blob URL, which file names can't be resolved against
      // The core names each file it opens; that is noise here.
      print: (t: string) => {
        if (!/^(Filename|pext):/.test(t)) log(t, "emu");
      },
      printErr: (t: string) => log(t, "err"),
    });
    // The core tells ROMs from saved states by the extension.
    const path = /\.sav$/i.test(name) ? "/calc.sav" : "/calc.rom";
    emu.FS.writeFile(path, rom);
    const id = emu.ccall("wabbit_load", "number", ["string"], [path]) as number;
    if (id < 0 || id >= WABBIT_MODELS.length) return null;
    const model = WABBIT_MODELS[id];
    if (romModels[name] !== model) {
      romModels[name] = model;
      remember(NAMES_PREF, romModels);
      fillMenu(known);
    }
    const running = window.setInterval(
      () => emu._wabbit_frame(),
      1000 / emu._wabbit_fps(),
    );
    // The OS is still settling just after it turns on, and doesn't answer the link yet.
    await sleep(1500);
    const l = id === TI_85 || id === TI_86 ? LAYOUT_86 : LAYOUT_CE;
    const key = (k: Key, down: boolean) =>
      emu._wabbit_key(7 - k.row, k.col, down ? 1 : 0);
    const keyFor = (label: string) => l.macro.get(label)!;
    /** Letters with alpha, digits as they are, from the keys' alpha letters. */
    const typeChar = async (c: string) => {
      const lower = c === "θ" ? "#" : c.toLowerCase();
      if (/[0-9]/.test(c)) return tap(l.byKbd.get(c)!, 100, 120);
      const letter = l.byKbd.get(lower);
      if (!letter) return;
      await tap(keyFor("alpha"), 100, 120);
      await tap(letter, 100, 120);
    };
    const plus = id >= TI_83P;
    return {
      kind: "wabbit",
      model,
      family: plus ? "plus" : "other",
      layout: l,
      width: emu._wabbit_lcd_width(),
      height: 64,
      frame(out) {
        if (!emu._wabbit_lcd_on()) return false;
        const width = out.width,
          ptr = emu._wabbit_lcd(),
          src = emu.HEAPU8,
          dst = out.data;
        // The LCD's greens, from clear to dark, as on the real screen.
        for (let y = 0; y < 64; y++)
          for (let x = 0; x < width; x++) {
            const v = src[ptr + y * 128 + x] / 255,
              i = (y * width + x) * 4;
            dst[i] = 168 - v * 148;
            dst[i + 1] = 181 - v * 153;
            dst[i + 2] = 146 - v * 126;
            dst[i + 3] = 255;
          }
        return true;
      },
      key,
      async send(file) {
        const path = `/send.${file.name.split(".").pop()!.toLowerCase()}`;
        emu.FS.writeFile(path, file.bytes);
        try {
          // A busy calculator times out (2) or drops the link mid-packet (9); give it a moment and try again.
          for (let attempt = 0; ; attempt++) {
            const err = emu.ccall(
              "wabbit_send",
              "number",
              ["string", "number"],
              [path, /\.8xg$/i.test(file.name) ? 1 : 0],
            ) as number;
            if (!err) break;
            if ((err !== 2 && err !== 9) || attempt === 3)
              throw new Error(LINK_ERRORS[err] ?? `Link error ${err}.`);
            await sleep(700);
          }
        } finally {
          try {
            emu.FS.unlink(path);
          } catch {
            /* already gone */
          }
        }
      },
      reset: () => emu._wabbit_reset(),
      stop: () => window.clearInterval(running),
      async launch(name) {
        if (!plus)
          throw new Error(
            `Run it from the PRGM menu: TIde starts programs on the TI-83 Plus and 84 Plus.`,
          );
        // The PRGM menu lists programs by name and jumps to the first one starting with a letter
        // that's pressed; the arrows go on from there to the right one. Enter pastes it, Enter runs it.
        const names = emu
          .UTF8ToString(emu._wabbit_programs())
          .split("\n")
          .filter(Boolean)
          .sort();
        const target = name.toUpperCase().replace(/θ/g, "["); // θ is "[" in a name
        if (!names.includes(target))
          throw new Error(`${target} isn't on the calculator.`);
        const before = names.filter(
          (n) => n[0] === target[0] && n < target,
        ).length;
        await tap(keyFor("clear"));
        await tap(keyFor("prgm"), 120, 400);
        const first = l.byKbd.get(
          target[0] === "[" ? "#" : target[0].toLowerCase(),
        );
        if (first) await tap(first, 100, 200);
        for (let i = 0; i < before; i++) await tap(keyFor("▼"), 80, 100);
        await tap(keyFor("enter"), 120, 250);
        await tap(keyFor("enter"));
      },
      async type(text) {
        for (const c of text.toUpperCase()) await typeChar(c);
      },
      async openApp(name) {
        if (!plus)
          throw new Error("app.open works on the TI-83 Plus and 84 Plus.");
        await tap(keyFor("apps"), 120, 400);
        const first = l.byKbd.get(name.charAt(0).toLowerCase());
        if (first) await tap(first, 100, 200);
        await tap(keyFor("enter"), 120, 400);
      },
    };
  }

  // ── A real calculator, over USB ──
  /** The calculator's family, from libticalcs's name for it ("TI84+CE", "TI83+", "TI84+ USB"…). */
  const familyOf = (model: string): Engine["family"] =>
    /CE|PCE/i.test(model)
      ? "ce"
      : /^TI-?8[34]\+|^TI-?82A/i.test(model)
        ? "plus"
        : "other";
  const nameOf = (model: string) =>
    model.replace(/^TI-?/i, "TI-").replace(/ USB$/i, "");
  let link: Connected | null = null;

  function usbEngine(l: Connected): Engine {
    const notHere = (what: string) => async () => {
      throw new Error(
        `${what} works in the emulator. On a real calculator, use its keys.`,
      );
    };
    return {
      kind: "usb",
      model: nameOf(l.model),
      family: familyOf(l.model),
      layout: LAYOUT_CE,
      width: 320,
      height: 240,
      frame: () => false,
      key: () => {},
      // Groups only go into archive memory, as on the emulator.
      send: (file) =>
        l.send(
          file.name,
          /\.8xg$/i.test(file.name) ? archived(file.bytes) : file.bytes,
        ),
      reset: () => {},
      stop: () => {
        if (link === l) link = null;
        void l.close();
      },
      async launch(name) {
        throw new Error(
          `Start it on the calculator: prgm, then ${name.toUpperCase()}.`,
        );
      },
      type: notHere("key.type"),
      openApp: notHere("app.open"),
    };
  }

  function showLinked() {
    if (!engine || !isReal(engine.kind)) return;
    const serial = engine.kind === "serial";
    const runs =
      serial && serialLink?.remote
        ? "Run sends the program and starts it on the calculator, pressing its keys over the cable; key.press, key.type and app.open in tide.json do too."
        : "Run sends the program; start it from the calculator's prgm menu.";
    setup(
      `Connected to the ${engine.model} over ${serial ? `the serial cable (${serialName})` : "USB"}.\nSend files to it, or build and run. ${runs}\nKeep it on the home screen while files are sent.`,
      "disconnect",
    );
    ui.state.textContent = "connected";
  }

  /** From a click on Connect: the browser only asks which device to use during one. */
  async function connectUsb(device: USBDeviceLike) {
    ui.connect.disabled = true;
    ui.state.textContent = "connecting…";
    try {
      if (engine) await stop();
      const l = await connect(
        (text, err) => log(text.replace(/\n$/, ""), err ? "err" : "info"),
        device,
      );
      link = l;
      engine = usbEngine(l);
      sentLibs.clear();
      l.onLost(() => {
        if (link !== l) return;
        link = null;
        if (engine && isReal(engine.kind)) engine = null;
        say("The calculator was unplugged.");
        if (choice === "real") void ready();
      });
      setCredit();
      showLinked();
      say(`Connected to the ${engine.model}.`);
    } catch (err) {
      ui.state.textContent = "";
      say(err instanceof Error ? err.message : String(err));
    } finally {
      ui.connect.disabled = false;
    }
  }

  // ── A real calculator, over a serial cable: TIde's own link protocol (dbus.ts), connected in
  // the Serial tab (serial-view.ts), which hands the connection over with attachSerial() ──
  let serialName = "";
  let serialLink: DbusLink | null = null;

  function serialEngine(l: DbusLink): Engine {
    // Over the cable, TIde presses the calculator's keys itself (remote control, as TILP does).
    return {
      kind: "serial",
      model: l.model,
      family: modelFamily(l.model),
      layout: LAYOUT_CE,
      width: 320,
      height: 240,
      frame: () => false,
      key: (k, down) => {
        if (down)
          l.press(k.label).catch((err) =>
            say(String(err instanceof Error ? err.message : err)),
          );
      },
      press: (name) => l.press(name),
      send: (file) => l.sendFile(file.name, file.bytes),
      reset: () => {},
      stop: () => {
        if (serialLink === l) {
          serialLink = null;
          void l.close();
          opts.serialDropped?.();
        }
      },
      launch: (name) => l.run(name),
      type: (text) => l.type(text),
      openApp: (name) => l.openApp(name),
    };
  }

  /** tide.json's "link": the row the connections popup starts on. */
  let prefer: { via?: "usb" | "serial"; port?: string; model?: string } = {};

  /** From a click on Connect: the connections popup, then whichever was picked. */
  async function connectReal() {
    const picked = await chooseConnection(prefer, (text) => log(text, "info"));
    if (!picked) return;
    if (picked.kind === "usb") return connectUsb(picked.device);
    if (picked.kind === "evo") {
      try {
        say(
          await describeDevice(picked.device as never, (line) =>
            log(line, "info"),
          ),
        );
      } catch (err) {
        say(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    ui.connect.disabled = true;
    ui.state.textContent = "connecting…";
    try {
      if (engine) await stop();
      const byteLink = await openSerialPort(picked.port);
      // "Find out": ask the calculator which it is, as TILP's probe does.
      let model = picked.model;
      if (model === "auto") {
        ui.state.textContent = "asking which calculator…";
        const answered = await detectModel(byteLink, (text) =>
          log(text, "info"),
        ).catch(async (err) => {
          await byteLink.close().catch(() => {});
          throw err;
        });
        if (!answered) {
          await byteLink.close().catch(() => {});
          throw new Error(
            `No calculator answered on ${byteLink.name}. Is it on, and is the cable in all the way? A TI-82 only answers with Link > Receive started; or pick the calculator in the list instead of Find out.`,
          );
        }
        model = answered;
      }
      const l = new DbusLink(byteLink, model, (text) => log(text, "info"));
      try {
        await l.check();
      } catch (err) {
        await l.close().catch(() => {});
        throw err;
      }
      serialLink = l;
      serialName = byteLink.name;
      engine = serialEngine(l);
      sentLibs.clear();
      setCredit();
      showLinked();
      opts.serialConnected?.(l, byteLink.name);
      say(
        model === "TI-82"
          ? `Ready to send to the TI-82 on ${byteLink.name}. Start Link > Receive on it before each send.`
          : `Connected to the ${model} on ${byteLink.name}.`,
      );
    } catch (err) {
      ui.state.textContent = "";
      say(err instanceof Error ? err.message : String(err));
    } finally {
      ui.connect.disabled = false;
    }
  }

  function setCredit() {
    const kind =
      engine?.kind ??
      (choice === "real"
        ? "usb"
        : choice.startsWith("rom:")
          ? "wabbit"
          : "cemu");
    const credit = $<HTMLAnchorElement>("calc-credit");
    $("calc-credit-what").textContent = isReal(kind) ? "The link" : "Emulation";
    // The serial link is TIde's own, from the TI Link Protocol Guide.
    credit.textContent =
      kind === "cemu"
        ? "CEmu"
        : kind === "wabbit"
          ? "Wabbitemu"
          : kind === "usb"
            ? "TILP's libraries (WebTILP)"
            : "TIde, after the TI Link Protocol Guide";
    credit.href =
      kind === "cemu"
        ? "https://github.com/CE-Programming/CEmu"
        : kind === "wabbit"
          ? "https://github.com/marwatk/wasmwabbitemu"
          : kind === "usb"
            ? "https://github.com/debrouxl/tilibs"
            : "https://merthsoft.com/linkguide/";
    $("calc-license").textContent =
      kind === "cemu"
        ? "GPLv3"
        : kind === "serial"
          ? "TIde's license"
          : "GPLv2+";
  }

  // ── Firebird, for the TI-Nspire CX ──
  async function startFirebird(): Promise<Engine | null> {
    const [script, wasm, boot1, flash] = await Promise.all([
      read("firebird.js"),
      read("firebird.wasm"),
      read("nspire/boot1.img"),
      read("nspire/flash.img"),
    ]);

    if (boot1.byteLength !== 524288) {
      throw new Error(
        `Invalid boot1 size: ${boot1.byteLength} bytes (expected 524,288 bytes).`,
      );
    }
    if (flash.byteLength === 0) {
      throw new Error("Flash image is empty (0 bytes).");
    }

    const fbErrors: string[] = [];
    let domCanvas = document.getElementById(
      "canvas",
    ) as HTMLCanvasElement | null;
    const createdCanvas = !domCanvas;
    if (!domCanvas) {
      domCanvas = document.createElement("canvas");
      domCanvas.id = "canvas";
      domCanvas.width = 320;
      domCanvas.height = 240;
      domCanvas.style.display = "none";
      document.body.appendChild(domCanvas);
    }

    const g = globalThis as Record<string, unknown>;
    let lcdWidth = 320;
    let lcdHeight = 240;
    const latestFrame = new Uint8ClampedArray(320 * 240 * 4);

    g.initLCD = (w?: number, h?: number) => {
      if (typeof w === "number" && w > 0) lcdWidth = w;
      if (typeof h === "number" && h > 0) lcdHeight = h;
      if (domCanvas) {
        domCanvas.width = lcdWidth;
        domCanvas.height = lcdHeight;
      }
    };

    g.paintLCD = (...args: unknown[]) => {
      const first = args;
      if (first instanceof Uint8ClampedArray || first instanceof Uint8Array) {
        latestFrame.set(first.subarray(0, latestFrame.length));
        return;
      }
      const ptr = typeof first === "number" ? first : 0;
      if (ptr > 0 && emu?.HEAPU8) {
        const pixels = lcdWidth * lcdHeight;
        if (emu.HEAPU8[ptr + 3] === 255 && emu.HEAPU8[ptr + 7] === 255) {
          latestFrame.set(emu.HEAPU8.subarray(ptr, ptr + pixels * 4));
        } else {
          const view = new DataView(emu.HEAPU8.buffer, ptr, pixels * 2);
          for (let i = 0; i < pixels; i++) {
            const rgb565 = view.getUint16(i * 2, true);
            latestFrame[i * 4] = (((rgb565 >> 11) & 0x1f) * 255) / 31;
            latestFrame[i * 4 + 1] = (((rgb565 >> 5) & 0x3f) * 255) / 63;
            latestFrame[i * 4 + 2] = ((rgb565 & 0x1f) * 255) / 31;
            latestFrame[i * 4 + 3] = 255;
          }
        }
      }
    };

    g.fbProgress = (p: number) => {
      fbProgress?.(p);
    };
    g.updateStatus = (msg: string) => {
      if (msg) log(String(msg), "emu");
    };

    const emu = await loadModule<FirebirdEmu>(script, {
      locateFile: (file: string) => file,
      canvas: domCanvas,
      noInitialRun: true,
      print: (t: string) => log(t, "emu"),
      printErr: (t: string) => {
        fbErrors.push(t);
        log(
          t,
          /\b(?:error|fail|bad|couldn't|invalid)/i.test(t) ? "err" : "emu",
        );
      },
      instantiateWasm(
        imports: WebAssembly.Imports,
        done: (instance: WebAssembly.Instance) => void,
      ) {
        WebAssembly.instantiate(wasm as BufferSource, imports).then(
          ({ instance }) => done(instance),
        );
        return {};
      },
    });

    emu.FS.writeFile("/boot1.img", boot1);
    emu.FS.writeFile("/flash.img", flash);
    emu.FS.writeFile("boot1.img", boot1);
    emu.FS.writeFile("flash.img", flash);

    // The bridge's paintLCD/fb_paint writes the 320x240 RGBA frame into a buffer in the wasm heap,
    // so give it one to fill. (Calling _paintLCD with no pointer would splat the frame over address 0.)
    const framePtr =
      typeof emu._malloc === "function" ? emu._malloc(latestFrame.length) : 0;

    if (typeof emu._fb_start === "function") {
      // The rebuilt bridge boots explicitly; its _main does nothing.
      if (!emu._fb_start())
        throw new Error("Firebird couldn't boot from boot1.img and flash.img.");
    } else if (
      typeof emu.callMain === "function" ||
      typeof emu._main === "function"
    ) {
      // The stock web build's main() boots, then registers its own step loop and unwinds.
      try {
        if (typeof emu.callMain === "function")
          emu.callMain(["boot1.img", "flash.img"]);
        else emu._main!(0, 0);
      } catch (e) {
        const msg = String(e);
        if (!/unwind|SimulateInfiniteLoop/i.test(msg)) {
          const detail = fbErrors.filter(Boolean).slice(-3).join(" | ");
          throw new Error(
            detail
              ? `Firebird failed to start: ${detail}`
              : `Firebird main() threw: ${msg}`,
          );
        }
      }
    } else {
      throw new Error("firebird.wasm does not export _main.");
    }

    await sleep(1000);
    // fb_touch takes touchpad coordinates with y = 0 at the top: up is [0.5, 0], down is [0.5, 1].
    const TOUCH: [number, number][] = [
      [0.5, 0],
      [0, 0.5],
      [1, 0.5],
      [0.5, 1],
      [0.5, 0.5],
    ];

    const allocCString = (str: string): number => {
      const bytes = new TextEncoder().encode(str + "\0");
      const ptr = emu._malloc(bytes.length);
      emu.HEAPU8.set(bytes, ptr);
      return ptr;
    };

    // Auto-continue: during e.g. an Ndless install the guest takes a CPU exception and the core's
    // return_to_loop() unwinds out of fb_step (emu_restart_exception, caught inside fb_step; older
    // builds aborted the whole wasm on it). Like pressing "continue" once on a real calc, a failed
    // step must not kill the animation loop — catch it, log it once per distinct error, keep going.
    let lastStepError = "";

    return {
      kind: "firebird",
      model: "TI-Nspire CX",
      family: "nspire",
      layout: LAYOUT_NS,
      width: 320,
      height: 240,
      frame(out) {
        try {
          if (typeof emu._fb_step === "function") emu._fb_step();
          const paint = emu._fb_paint ?? emu._paintLCD;
          if (paint && framePtr) {
            paint(framePtr);
            out.data.set(
              emu.HEAPU8.subarray(framePtr, framePtr + latestFrame.length),
            );
          } else {
            out.data.set(latestFrame); // a bridge that reports through the global paintLCD instead
          }
        } catch (e) {
          const msg = String(e);
          if (msg !== lastStepError) {
            lastStepError = msg;
            log(`Firebird step auto-continued past: ${msg}`, "err");
          }
          out.data.set(latestFrame);
        }
        return true;
      },
      key: (key, down) => {
        if (key.row === 8 && typeof emu._fb_touch === "function") {
          const [x, y] = TOUCH[key.col] ?? [0.5, 0.5];
          emu._fb_touch(x, y, down ? 1 : 0, down ? 1 : 0);
        } else if (typeof emu._fb_key === "function") {
          emu._fb_key(key.row, key.col, down ? 1 : 0);
        } else if (key.kbd?.length) {
          // No fb_key export (stock web build): synthesize a DOM event so the keypad bridge
          // installed in firebird's emscripten main.cpp (window-level listeners) picks it up.
          const target = emu.canvas ?? domCanvas ?? document;
          target.dispatchEvent(
            new KeyboardEvent(down ? "keydown" : "keyup", {
              key: key.kbd[0],
              code: key.kbd[0],
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      },
      async send(file, label) {
        const name = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
        // The local copy lives in the emulator's own FS. The remote path is only the file name:
        // the Nspire OS already saves incoming link files under /documents, so sending
        // "/documents/x" would make it "/documents/documents/x", whose folder doesn't exist,
        // and the put would fail with "Didn't get FF 00 or 06 XX".
        const local = `/documents/${name}`;
        const remote = name;
        try {
          emu.FS.mkdirTree("/documents");
        } catch {
          /* already exists */
        }
        emu.FS.writeFile(local, file.bytes);
        try {
          // The no-progress window scales with the file size: the emulated OS accepts a big file and
          // writes it to flash in emulated time, which runs slower than wall-clock, so a large
          // transfer can legitimately go quiet for far longer than 15 s. Every progress report
          // resets the timer, so this only bounds a real stall.
          const stallMs = 15000 + Math.ceil(file.bytes.length / 1024) * 1000;
          // Whether the core popped the queued file (progress < 0). A stalled attempt leaves it
          // queued, so retries after a stall just keep waiting instead of queueing duplicates.
          let refused = false;
          for (let attempt = 0; ; attempt++) {
            try {
              await new Promise<void>((resolve, reject) => {
                let timer = 0,
                  shown = -1;
                const stall = () => {
                  window.clearTimeout(timer);
                  timer = window.setTimeout(() => {
                    fbProgress = null;
                    reject(
                      new Error(
                        "The calculator stopped taking the file. Is it on the home screen?",
                      ),
                    );
                  }, stallMs);
                };
                fbProgress = (p) => {
                  if (p >= 100) {
                    window.clearTimeout(timer);
                    fbProgress = null;
                    resolve();
                  } else if (p < 0) {
                    window.clearTimeout(timer);
                    fbProgress = null;
                    refused = true;
                    reject(new Error("The calculator refused the file."));
                  } else {
                    stall();
                    const percent = Math.min(99, p);
                    if (percent >= shown + 10) {
                      shown = percent - (percent % 10);
                      opts.say(`${label}… ${shown}%`);
                    }
                  }
                };
                stall();
                if (typeof emu._fb_send !== "function") {
                  window.clearTimeout(timer);
                  fbProgress = null;
                  reject(
                    new Error(
                      "This Firebird WASM build does not support _fb_send.",
                    ),
                  );
                } else if (attempt === 0 || refused) {
                  refused = false;
                  const localPtr = allocCString(local);
                  const remotePtr = allocCString(remote);
                  try {
                    emu._fb_send(localPtr, remotePtr);
                  } finally {
                    emu._free?.(localPtr);
                    emu._free?.(remotePtr);
                  }
                }
                // else: the stalled attempt left the file queued in the core, whose 100 Hz throttle
                // pump starts it once the calculator is ready; just wait for progress.
              });
              break;
            } catch (err) {
              if (attempt === 4) throw err;
              log(
                `Retrying ${file.name}: the calculator wasn't ready yet.`,
                "info",
              );
              await sleep(2000);
            }
          }
        } finally {
          fbProgress = null;
          try {
            emu.FS.unlink(local);
          } catch {
            /* already gone */
          }
        }
      },
      reset: () => {
        if (typeof emu._fb_reset === "function") emu._fb_reset();
      },
      stop() {
        if (createdCanvas && domCanvas?.parentNode) {
          domCanvas.parentNode.removeChild(domCanvas);
        }
        try {
          if (
            typeof emu._fb_flash_dirty === "function" &&
            typeof emu._fb_save_flash === "function"
          ) {
            if (emu._fb_flash_dirty() && emu._fb_save_flash()) {
              const bytes = emu.FS.readFile("/flash.img");
              void saveNspireFlash(bytes).catch(() => {});
            }
          }
        } catch {
          /* ignore */
        }
      },
      async launch() {
        throw new Error(
          "Run it from the Nspire's home screen: TIde starts programs on the TI-83 Plus, 84 Plus and CE.",
        );
      },
      async type(text) {
        for (const c of text) {
          const key =
            LAYOUT_NS.byKbd.get(c) ?? LAYOUT_NS.byKbd.get(c.toLowerCase());
          if (key) await tap(key, 100, 120);
        }
      },
      async openApp() {
        throw new Error("app.open works on the TI-83 Plus, 84 Plus and CE.");
      },
    };
  }

  async function start(): Promise<boolean> {
    const have = (known = await files());
    fillMenu(have);
    if (choice === "real") {
      setCredit();
      if (engine && isReal(engine.kind)) {
        showLinked();
        return true;
      }
      setup(
        "Plug in your calculator: over USB (a calculator with a USB port, or the SilverLink cable for older ones), or on a serial port with TI's grey TI-Graph Link. Turn it on, and connect: TIde lists every connection it can find.\nOn Windows, USB needs the WinUSB driver for the calculator or cable: install it with Zadig (zadig.akeo.ie), as for TILP.",
        "connect",
      );
      ui.state.textContent = "";
      return false;
    }
    const rom = choice.startsWith("rom:") ? choice.slice(4) : null;
    if (choice === "nspire") {
      if (!have.nspire.boot1 || !have.nspire.flash) {
        setup(
          "Choose a boot1 image (512 KB) and a flash image (33 or 132 MB) dumped from your own TI-Nspire CX. TIde keeps copies in its data folder.",
          "rom",
        );
        return false;
      }
    } else if (!rom && !have.rom) {
      setup(
        "Choose a ROM dumped from your own calculator: a TI-84 Plus CE, or a TI-73, 81, 82, 83, 83 Plus, 84 Plus, 85 or 86. TIde keeps a copy in its data folder.",
        "rom",
      );
      return false;
    }
    setup("", null);
    ui.state.textContent = "starting…";
    // The draw loop only starts once the engine is up; until then show a loading screen, not a black one.
    setScreenSize(320, 240);
    drawOff("Loading…");
    let next: Engine | null;
    let startError = "";
    try {
      next =
        choice === "nspire"
          ? await startFirebird()
          : rom
            ? await startWabbit(rom)
            : await startCemu();
    } catch (err) {
      startError = err instanceof Error ? err.message : String(err);
      log(startError, "err");
      next = null;
    }
    if (!next) {
      const fallback =
        choice === "nspire"
          ? "Firebird couldn't start with those images. Choose a TI-Nspire CX boot1 and flash image, or pick a different calculator above."
          : rom
            ? `Wabbitemu couldn't start with ${rom}. Choose another ROM, or pick a different calculator above.`
            : "CEmu couldn't start with that ROM. Choose a TI-84 Plus CE ROM.";
      setup(startError ? `${fallback} (${startError})` : fallback, "rom");
      if (startError) opts.say(startError);
      ui.state.textContent = "";
      return false;
    }
    engine = next;
    const credit = $<HTMLAnchorElement>("calc-credit");
    credit.textContent =
      engine.kind === "cemu"
        ? "CEmu"
        : engine.kind === "wabbit"
          ? "Wabbitemu"
          : "Firebird";
    credit.href =
      engine.kind === "cemu"
        ? "https://github.com"
        : engine.kind === "wabbit"
          ? "https://github.com"
          : "https://github.com";
    $("calc-license").textContent =
      engine.kind === "wabbit" ? "GPLv2+" : "GPLv3";
    buildKeypad(engine.layout);
    setScreenSize(engine.width, engine.height);
    ui.state.textContent = "running";
    if (rom) log(`Started a ${engine.model} from ${rom}.`, "info");
    if (choice === "nspire")
      log(
        "Started a TI-Nspire CX from the stored boot1 and flash images.",
        "info",
      );
    if (!drawing) {
      drawing = true;
      requestAnimationFrame(draw);
    }
    return true;
  }

  const ready = (): Promise<boolean> => {
    if (engine) {
      if (isReal(engine.kind)) showLinked();
      return Promise.resolve(true);
    }
    return (starting ??= start().finally(() => {
      starting = null;
    }));
  };

  /** Stops the running calculator, so the next ready() starts the chosen one afresh. */
  async function stop() {
    if (starting) await starting.catch(() => false);
    engine?.stop();
    engine = null;
    sentLibs.clear();
  }

  async function choose(next: string) {
    choice = next;
    remember(MODEL_PREF, next);
    await stop();
    fillMenu(known);
    if (await ready()) say(`Switched to the ${engine!.model}.`);
    else if (next === "real")
      say("Connect your calculator to send files to it.");
  }

  async function addRom() {
    if (choice === "nspire") {
      const boot1 = await opts.pickRom("TI-Nspire CX boot1 image (512 KB)", [
        "img",
        "bin",
        "rom",
      ]);
      if (!boot1) return;
      const flash = await opts.pickRom(
        "TI-Nspire CX flash image (33 or 132 MB)",
        ["img", "bin"],
      );
      if (!flash) return;
      try {
        await invoke("calc_set_nspire", { boot1, flash });
        say("Saved the Nspire boot1 and flash images.");
        known = await files();
        await choose("nspire");
      } catch (err) {
        say(String(err));
      }
      return;
    }
    const path = await opts.pickRom("Calculator ROM or Nspire image", [
      "rom",
      "sav",
      "img",
      "bin",
    ]);
    if (!path) return;
    try {
      const stored = await invoke<string>("calc_set_rom", { path });
      say(
        stored === "ce"
          ? "Saved the TI-84 Plus CE ROM."
          : stored === "nspire"
            ? "Saved the Nspire image. Add the other one, or pick TI-Nspire CX above, to start it."
            : `Saved ${stored.slice(4)}.`,
      );
      known = await files();
      await choose(stored);
    } catch (err) {
      say(String(err));
    }
  }

  ui.model.addEventListener("change", async () => {
    const value = ui.model.value;
    ui.model.value = choice; // until the choice is made
    if (value === "add") return addRom();
    if (value === "remove") {
      const name = choice.slice(4);
      if (
        !confirm(
          `Remove ${name} from TIde? The file you added it from stays where it is.`,
        )
      )
        return;
      try {
        await invoke("calc_remove_rom", { name });
        delete romModels[name];
        remember(NAMES_PREF, romModels);
        known = await files();
        await choose("ce");
      } catch (err) {
        say(`Could not remove ${name}: ${err}`);
      }
      return;
    }
    if (value === "remove-nspire") {
      if (
        !confirm(
          "Remove the Nspire boot1 and flash images from TIde? The files you added them from stay where they are.",
        )
      )
        return;
      try {
        await invoke("calc_remove_nspire");
        known = await files();
        await choose("ce");
      } catch (err) {
        say(`Could not remove the Nspire images: ${err}`);
      }
      return;
    }
    if (value !== choice) await choose(value);
  });
  ui.rom.addEventListener("click", () => void addRom());
  ui.connect.addEventListener("click", () => void connectReal());
  ui.disconnect.addEventListener("click", async () => {
    await stop();
    say("Disconnected the calculator.");
    await ready();
  });
  ui.reset.addEventListener("click", () => {
    engine?.reset();
    sentLibs.clear();
    say("Reset the calculator.");
  });
  // Reload ROM: stop this emulator and boot a new one from the stored ROM, as if the calculator was
  // just turned on with a fresh memory. Picks up a ROM changed with Choose ROM… too.
  ui.reload.addEventListener("click", async () => {
    ui.reload.disabled = true;
    try {
      await stop();
      log("Reloading the ROM…", "info");
      if (await ready()) say("Reloaded the ROM.");
    } catch (err) {
      say(`Could not reload the ROM: ${err}`);
    } finally {
      ui.reload.disabled = false;
    }
  });

  const view: Calc = {
    get visible() {
      return !ui.panel.hidden;
    },
    get consoleShown() {
      return consoleOpen;
    },
    set consoleShown(on: boolean) {
      showConsole(on);
    },
    async show() {
      ui.panel.hidden = false;
      opts.layout();
      if ((await ready()) && engine && !isReal(engine.kind)) ui.lcd.focus();
    },
    hide() {
      ui.panel.hidden = true;
      opts.layout();
    },
    async family() {
      // Starts the calculator without showing it, so the tab you're on stays active.
      return (await ready()) ? engine!.family : null;
    },
    async send(files) {
      await view.show();
      if (!engine) {
        say(
          isReal(choice)
            ? "Connect your calculator to send files to it."
            : "Set up the calculator to send files to it.",
        );
        return;
      }
      const all = (
        await Promise.all(
          files.map((f) => (BUNDLE.test(f.name) ? unbundle(f) : [f])),
        )
      ).flat();
      const skipped = all.filter((f) => !SENDABLE.test(f.name));
      const sendable = all.filter((f) => SENDABLE.test(f.name));
      for (const [i, file] of sendable.entries()) {
        const label = `Sending ${file.name}${sendable.length > 1 ? ` (${i + 1} of ${sendable.length})` : ""}`;
        say(`${label}…`);
        try {
          await engine.send(file, label);
        } catch (err) {
          throw new Error(
            `${file.name}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (skipped.length)
        say(
          `Skipped ${skipped.map((f) => f.name).join(", ")}: not a TI file a calculator can receive.`,
        );
      else if (sendable.length)
        say(
          `Sent ${sendable.length === 1 ? sendable[0].name : `${sendable.length} files`} to the ${engine.model}.`,
        );
    },
    setLink(cfg) {
      prefer = cfg ?? {};
      // A project that names its cable switches the calculator to a real one, unless it already is.
      if (cfg?.via && choice !== "real") void choose("real");
    },
    async connectReal() {
      // From anywhere (the Serial tab, the File menu): the calculator becomes the real one, without
      // leaving the tab you're on.
      if (choice !== "real") {
        await stop();
        choice = "real";
        remember(MODEL_PREF, choice);
        fillMenu(known);
        setCredit();
      }
      await connectReal();
    },
    async disconnectReal() {
      if (engine && isReal(engine.kind)) {
        await stop();
        if (!ui.panel.hidden) void ready();
      }
    },
    async macro(name, arg) {
      await view.show();
      if (!engine) throw new Error("Set up the calculator to run macros.");
      switch (name) {
        case "key.press": {
          if (engine.press) {
            await engine.press(arg);
            break;
          }
          const key = engine.layout.macro.get(arg.toLowerCase());
          if (!key)
            throw new Error(
              `key.press doesn't know "${arg}". Use a key name such as enter, clear, 2nd, alpha, up or 5.`,
            );
          await tap(key);
          break;
        }
        case "key.type":
          await engine.type(arg);
          break;
        case "program.run":
        case "program.open":
          await engine.launch(arg);
          break;
        case "app.open":
          await engine.openApp(arg);
          break;
        case "wait":
          await sleep(Math.max(0, Number(arg) || 0));
          break;
        default:
          throw new Error(`Unknown macro ${name}.`);
      }
      say(`${name}(${arg})`);
    },
    async run(programs, launch, libs = []) {
      await view.show();
      // The CE C libraries are only for the CE.
      const wanted = engine?.family === "ce" ? libs : [];
      const newLibs = wanted.filter(
        (l) => !sentLibs.has(`${l.name}:${l.bytes.length}`),
      );
      await view.send([...newLibs, ...programs]);
      if (!engine) return;
      for (const l of newLibs) sentLibs.add(`${l.name}:${l.bytes.length}`);
      if (launch) {
        try {
          await engine.launch(launch);
          say(`Running ${launch}`);
        } catch (err) {
          say(
            `Sent to the ${engine.model}. ${err instanceof Error ? err.message : err}`,
          );
        }
      } else say(`Sent to the ${engine.model}`);
      if (!isReal(engine.kind)) ui.lcd.focus();
    },
  };
  ui.close.addEventListener("click", () => view.hide());

  // Send files…, or drop them on the calculator.
  async function sendPaths(paths: string[]) {
    if (!paths.length) return;
    try {
      const files = await Promise.all(
        paths.map(async (p) => ({
          name: p.split(/[\\/]/).pop()!,
          bytes: await opts.readFile(p),
        })),
      );
      await view.send(files);
    } catch (err) {
      say(`Could not send: ${err instanceof Error ? err.message : err}`);
    }
  }
  ui.send.addEventListener("click", async () =>
    sendPaths(await opts.pickFiles()),
  );
  const dropping = (on: boolean) => {
    ui.drop.hidden = !on;
  };
  // The page gets the files themselves, in the desktop app too (its window leaves drops to the
  // page), and files dragged from the Explorer as their paths.
  ui.panel.addEventListener("dragover", (e) => {
    const types = e.dataTransfer?.types ?? [];
    if (!types.includes("Files") && !types.includes(TREE_DRAG)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    dropping(true);
  });
  ui.panel.addEventListener("dragleave", (e) => {
    if (!ui.panel.contains(e.relatedTarget as Node | null)) dropping(false);
  });
  ui.panel.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropping(false);
    const fromTree = e.dataTransfer?.getData(TREE_DRAG);
    if (fromTree) return sendPaths(fromTree.split("\n").filter(Boolean));
    // Extensions install instead, from the window's own drop handler.
    const list = [...(e.dataTransfer?.files ?? [])].filter(
      (f) => !/\.tideex$/i.test(f.name),
    );
    if (!list.length) return;
    try {
      await view.send(
        await Promise.all(
          list.map(async (f) => ({
            name: f.name,
            bytes: new Uint8Array(await f.arrayBuffer()),
          })),
        ),
      );
    } catch (err) {
      say(`Could not send: ${err instanceof Error ? err.message : err}`);
    }
  });
  return view;
}
