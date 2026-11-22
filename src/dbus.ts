// TI's link protocol ("DBUS"), written out in TIde: what a calculator's link port speaks, here over
// a serial cable (serial.ts) such as TI's grey TI-Graph Link. Nothing of WebTILP's is used.
// Calculators with a serial-cable link port: the TI-83 Plus, 83 Plus SE, 84 Plus and 84 Plus SE
// (through their I/O port), the TI-83 and the TI-73 take files silently; the TI-82 takes them with
// Link > Receive started on it. The CE family has only USB (link.ts).
//
// From the TI Link Protocol Guide (Tim Singer and Romain Liévin, merthsoft.com/linkguide), checked
// against TILP's libticalcs (dbus_pkt.cc, cmdz80.cc, calc_73.cc and calc_8x.cc in debrouxl/tilibs):
// - A packet: machine ID, command ID, a 16-bit length (little-endian), then for commands that carry
//   data, the data and a 16-bit checksum: the low 16 bits of the sum of the data bytes. Commands
//   without data (ACK, CTS, EOT…) may still use the length field: the ACK to RDY says "busy" there.
// - Sending a variable silently (TI-73, 83, 83 Plus, 84 Plus): computer RTS (its header) →
//   calculator ACK, then CTS, or SKIP with a reason → computer ACK, DATA → calculator ACK →
//   computer EOT, after each variable.
// - Manually (TI-82): VAR instead of RTS, the calculator's CTS can wait for whoever is at it (a
//   variable with that name already there asks what to do), and one EOT, answered with ACK, after
//   the last variable.

/** A byte stream to a calculator: a serial port, or another cable. */
export interface ByteLink {
  /** What's on the other end, for messages: "COM3". */
  name: string;
  write(bytes: Uint8Array): Promise<void>;
  /** Up to `max` bytes, waiting at most `timeoutMs` for the first; empty if none came. */
  read(max: number, timeoutMs: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** The calculators this protocol reaches, as named in the panel and in tide.json. */
export const DBUS_MODELS = ["TI-84 Plus", "TI-84 Plus SE", "TI-83 Plus", "TI-83 Plus SE", "TI-83", "TI-82", "TI-73"] as const;
export type DbusModel = (typeof DBUS_MODELS)[number];

interface ModelInfo {
  /** The machine ID the computer sends to it. */
  pc: number;
  /** Its own, on what it sends. */
  calc: number;
  /** 13-byte headers (version and flag bytes) or 11-byte ones. */
  long: boolean;
  /** Takes files without Link > Receive. */
  silent: boolean;
  /** The file signature its files carry. */
  signatures: string[];
}
const PLUS: ModelInfo = { pc: 0x23, calc: 0x73, long: true, silent: true, signatures: ["**TI83F*"] };
const MODELS: Record<DbusModel, ModelInfo> = {
  "TI-84 Plus": PLUS, "TI-84 Plus SE": PLUS, "TI-83 Plus": PLUS, "TI-83 Plus SE": PLUS,
  // The TI-83 also reads the TI-82's files.
  "TI-83": { pc: 0x03, calc: 0x83, long: false, silent: true, signatures: ["**TI83**", "**TI82**"] },
  "TI-82": { pc: 0x02, calc: 0x82, long: false, silent: false, signatures: ["**TI82**"] },
  "TI-73": { pc: 0x07, calc: 0x74, long: false, silent: true, signatures: ["**TI73**"] },
};
export const modelFamily = (model: DbusModel): "plus" | "other" => (MODELS[model].long ? "plus" : "other");

const CMD = { VAR: 0x06, CTS: 0x09, DATA: 0x15, SKIP: 0x36, ACK: 0x56, ERR: 0x5a, RDY: 0x68, SCR: 0x6d, KEY: 0x87, EOT: 0x92, RTS: 0xc9 } as const;
/** Commands that never carry data, whatever their length field says (as libticalcs reads them). */
const NO_DATA = new Set([CMD.CTS, CMD.ACK, CMD.ERR, CMD.RDY, CMD.EOT, 0x6d /* SCR */, 0x2d /* VER */, 0x87 /* KEY */]);
const NAMES: Record<number, string> = Object.fromEntries(Object.entries(CMD).map(([k, v]) => [v, k]));
/** Why a calculator refused a variable (SKIP's reason). 2 isn't here: it skips that one and goes on. */
const SKIP_REASONS: Record<number, string> = {
  1: "The calculator cancelled the transfer.",
  3: "There isn't enough memory on the calculator.",
  4: "The calculator's OS is too old for this variable.",
};
const SKIPPED = 2;

// ── Variable files ──

export interface TiVar {
  type: number;
  /** The name, as its 8 bytes on the calculator (tokenized, zero-padded). */
  name: Uint8Array;
  version: number;
  archived: boolean;
  /** The variable's data, as stored: for a program, its 2-byte length and then its tokens. */
  data: Uint8Array;
}

/** Type IDs that aren't plain variables, which take a different procedure (Flash) or none at all. */
const FLASH_TYPES = new Set([0x23, 0x24, 0x27]);

/** The variables in a TI variable file (.8xp, .83p, .82p, .73p and the rest), with the file's signature. */
export function parseVarFile(bytes: Uint8Array, fileName: string): { signature: string; vars: TiVar[] } {
  const signature = String.fromCharCode(...bytes.subarray(0, 8));
  if (!/^\*\*TI(?:7|8)[0-9][F*]\*?\*?$/.test(signature.replace(/\0/g, ""))) {
    throw new Error(`${fileName} isn't a TI variable file. Flash apps (.8xk) and OS files go through TI Connect or the USB link.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = 55 + view.getUint16(53, true);
  if (end > bytes.length) throw new Error(`${fileName} is cut short.`);
  const vars: TiVar[] = [];
  for (let at = 55; at + 2 <= end;) {
    const headerLen = view.getUint16(at, true);
    const dataLen = view.getUint16(at + 2, true);
    const type = bytes[at + 4];
    const name = bytes.slice(at + 5, at + 13);
    const long = headerLen >= 13;
    const version = long ? bytes[at + 13] : 0;
    const archived = long ? (bytes[at + 14] & 0x80) !== 0 : false;
    const dataAt = at + 2 + headerLen + 2;
    if (dataAt + dataLen > end) throw new Error(`${fileName} is cut short.`);
    if (FLASH_TYPES.has(type)) throw new Error(`${fileName} holds a Flash app or OS, which this cable can't send yet. Use the USB link.`);
    vars.push({ type, name, version, archived, data: bytes.slice(dataAt, dataAt + dataLen) });
    at = dataAt + dataLen;
  }
  if (!vars.length) throw new Error(`${fileName} has no variables in it.`);
  return { signature, vars };
}

/** A variable's name for messages: its letters, without the padding. */
export const varName = (v: TiVar) => String.fromCharCode(...[...v.name].filter(b => b >= 0x20 && b < 0x7f)) || "a variable";

// ── Packets ──

/** A packet. `len` is its length field, which a packet without data can use for other things. */
interface Packet { mid: number; cmd: number; len: number; data: Uint8Array }

function packet(mid: number, cmd: number, data?: Uint8Array): Uint8Array {
  if (!data) return Uint8Array.of(mid, cmd, 0, 0);
  const out = new Uint8Array(4 + data.length + 2);
  out.set([mid, cmd, data.length & 0xff, data.length >> 8]);
  out.set(data, 4);
  let sum = 0;
  for (const b of data) sum = (sum + b) & 0xffff;
  out[4 + data.length] = sum & 0xff;
  out[5 + data.length] = sum >> 8;
  return out;
}

/** Reads exact byte counts from a link, keeping what arrives early for the next read. */
class Reader {
  private held = new Uint8Array(0);
  constructor(private link: ByteLink) {}
  async take(n: number, timeoutMs: number): Promise<Uint8Array> {
    const until = performance.now() + timeoutMs;
    while (this.held.length < n) {
      const left = until - performance.now();
      if (left <= 0) throw new LinkTimeout();
      const more = await this.link.read(Math.max(64, n - this.held.length), Math.min(left, 1000));
      if (more.length) {
        const joined = new Uint8Array(this.held.length + more.length);
        joined.set(this.held);
        joined.set(more, this.held.length);
        this.held = joined;
      }
    }
    const out = this.held.slice(0, n);
    this.held = this.held.slice(n);
    return out;
  }
  async packet(timeoutMs: number): Promise<Packet> {
    const head = await this.take(4, timeoutMs);
    const cmd = head[1], len = head[2] | (head[3] << 8);
    if (NO_DATA.has(cmd)) return { mid: head[0], cmd, len, data: new Uint8Array(0) };
    const body = await this.take(len + 2, 5000);
    const data = body.subarray(0, len);
    let sum = 0;
    for (const b of data) sum = (sum + b) & 0xffff;
    if (sum !== (body[len] | (body[len + 1] << 8))) throw new DamagedPacket();
    return { mid: head[0], cmd, len, data: data.slice() };
  }
  /** Throws away whatever's waiting or arrives within `quietMs`, after a mix-up. */
  async drain(quietMs = 300) {
    this.held = new Uint8Array(0);
    while ((await this.link.read(4096, quietMs)).length) { /* keep reading until it's quiet */ }
  }
}

export class LinkTimeout extends Error {
  constructor() { super("The calculator didn't answer. Is it on, at the home screen, and is the cable plugged in all the way?"); }
}
class DamagedPacket extends Error {
  constructor() { super("A packet from the calculator was damaged on the way."); }
}

/** How long the calculator gets to answer. */
const ANSWER_MS = 4000;
/** Tries at a variable that times out or gets garbled, before giving up on it. */
const TRIES = 3;

// ── Remote keys: TI-OS key codes, as libticalcs's keys83p.h has them ──
// The TI-83 Plus family, the TI-73 and the TI-83 take them (the TI-82 doesn't).
const KEY = {
  right: 0x01, left: 0x02, up: 0x03, down: 0x04, enter: 0x05, clear: 0x09, del: 0x0a, ins: 0x0b,
  apps: 0x2c, prgm: 0x2d, zoom: 0x2e, stat: 0x31, math: 0x32, vars: 0x35, matrix: 0x37, list: 0x3a,
  quit: 0x40, graph: 0x44, mode: 0x45, window: 0x48, yequ: 0x49, trace: 0x5a,
  add: 0x80, sub: 0x81, mul: 0x82, div: 0x83, power: 0x84, lparen: 0x85, rparen: 0x86, store: 0x8a,
  comma: 0x8b, neg: 0x8c, point: 0x8d, varx: 0xb4, inverse: 0xb6, sin: 0xb7, cos: 0xb9, tan: 0xbb,
  square: 0xbd, ln: 0xbf, log: 0xc1, ans: 0xc5, theta: 0xcc, exec: 0xda,
  /** Asm(, for assembly programs on the TI-83 Plus family. */
  asm: 0xfc9c,
  /** Send(9, for assembly programs on the TI-83. */
  sendMbl: 0xfe63,
} as const;
/** A letter, digit or θ, as its key: digits 0x8E…, letters 0x9A… (typed as with alpha). */
const charKey = (c: string) => (/[0-9]/.test(c) ? 0x8e + Number(c) : /[A-Z]/.test(c) ? 0x9a + c.charCodeAt(0) - 65 : c === "θ" || c === "[" ? KEY.theta : 0);

/** Keys by the names the keypad and key.press use (calc.ts's labels and aliases). */
const KEY_NAMES: Record<string, number> = {
  "y=": KEY.yequ, yequ: KEY.yequ, window: KEY.window, zoom: KEY.zoom, trace: KEY.trace, graph: KEY.graph,
  mode: KEY.mode, quit: KEY.quit, del: KEY.del, delete: KEY.del, ins: KEY.ins, "x,t,θ,n": KEY.varx, "xtθn": KEY.varx, stat: KEY.stat,
  math: KEY.math, apps: KEY.apps, prgm: KEY.prgm, vars: KEY.vars, clear: KEY.clear,
  "x⁻¹": KEY.inverse, inverse: KEY.inverse, sin: KEY.sin, cos: KEY.cos, tan: KEY.tan, "^": KEY.power, power: KEY.power,
  "x²": KEY.square, square: KEY.square, ",": KEY.comma, "(": KEY.lparen, ")": KEY.rparen, "÷": KEY.div, "/": KEY.div,
  log: KEY.log, "×": KEY.mul, "*": KEY.mul, ln: KEY.ln, "−": KEY.sub, "-": KEY.sub, "sto→": KEY.store, sto: KEY.store, store: KEY.store,
  "+": KEY.add, ".": KEY.point, "(−)": KEY.neg, neg: KEY.neg, negative: KEY.neg, enter: KEY.enter, ans: KEY.ans,
  "▲": KEY.up, up: KEY.up, "▼": KEY.down, down: KEY.down, "◀": KEY.left, left: KEY.left, "▶": KEY.right, right: KEY.right,
  matrix: KEY.matrix, list: KEY.list,
};
/** The keypad's keys that aren't keys to TI-OS (they change what the next key does), and on. */
const NOT_A_KEY = new Set(["2nd", "second", "alpha", "on"]);

/** Whether a program is assembly: compiled programs start with the AsmPrgm token (BB 6D). */
const isAsm = (v: TiVar) => v.data[2] === 0xbb && v.data[3] === 0x6d;

/** The calculator refused a variable; trying again won't help. */
class Refused extends Error {}

/** A file's identity, to know it's the same one sent again. */
function checksum(bytes: Uint8Array) { let sum = 0; for (const b of bytes) sum = (sum * 31 + b) >>> 0; return sum; }

/** A connection to one calculator over a byte link. */
export class DbusLink {
  private reader: Reader;
  private info: ModelInfo;
  /** Programs sent, by name, so Run knows which are assembly. */
  private sent = new Map<string, TiVar>();
  /** Where a file that failed partway stopped, so sending it again goes on from there. */
  private stopped: { key: string; at: number } | null = null;

  constructor(private link: ByteLink, readonly model: DbusModel, private log: (text: string) => void = () => {}) {
    this.reader = new Reader(link);
    this.info = MODELS[model];
  }

  /** Whether it takes remote keys, so TIde can start programs and apps on it. */
  get remote() { return this.model !== "TI-82"; }

  private async send(cmd: number, data?: Uint8Array) {
    await this.link.write(packet(this.info.pc, cmd, data));
  }

  /**
   * The next packet, which must be one of `want`. The calculator's ERR resends `resend`; a packet
   * that arrives damaged is asked for again with ERR, as the protocol has it.
   */
  private async expect(want: number[], resend?: () => Promise<void>, timeoutMs = ANSWER_MS): Promise<Packet> {
    for (let tries = 0; ; tries++) {
      let p: Packet;
      try {
        p = await this.reader.packet(timeoutMs);
      } catch (err) {
        if (err instanceof DamagedPacket && tries < 3) { this.log("A packet came damaged; asking for it again."); await this.reader.drain(100); await this.send(CMD.ERR); continue; }
        throw err;
      }
      if (p.cmd === CMD.ERR && resend && tries < 3) { this.log("The calculator asked for a packet again."); await resend(); continue; }
      if (want.includes(p.cmd)) return p;
      throw new Error(`The calculator answered ${NAMES[p.cmd] ?? `0x${p.cmd.toString(16)}`} where TIde expected ${want.map(c => NAMES[c]).join(" or ")}.`);
    }
  }

  /** Checks the calculator is there and free: RDY, answered with ACK. Only the TI-83 Plus family and the TI-73 answer it. */
  async check() {
    if (this.info.calc !== 0x73 && this.info.calc !== 0x74) return;
    await this.send(CMD.RDY);
    const ack = await this.expect([CMD.ACK]);
    // As libticalcs reads it: bit 0 of the length's high byte means it's busy.
    if ((ack.len >> 8) & 1) throw new Error(`The ${this.model} is busy. Go to the home screen (press 2nd, mode) and connect again.`);
  }

  /** Whether the file is for this calculator. */
  fits(signature: string) { return this.info.signatures.includes(signature); }

  private header(v: TiVar): Uint8Array {
    const h = new Uint8Array(this.info.long ? 13 : 11);
    h[0] = v.data.length & 0xff; h[1] = v.data.length >> 8;
    h[2] = v.type;
    h.set(v.name.subarray(0, 8), 3);
    if (this.info.long) { h[11] = v.version; h[12] = v.archived ? 0x80 : 0; }
    return h;
  }

  /** Sends one variable, once. Returns false if the calculator skipped it. */
  private async sendVarOnce(v: TiVar): Promise<boolean> {
    const header = this.header(v);
    const offer = () => this.send(this.info.silent ? CMD.RTS : CMD.VAR, header);
    await offer();
    await this.expect([CMD.ACK], offer);
    // Manually, the person at the calculator may have to answer it first (a name that's taken).
    const answer = await this.expect([CMD.CTS, CMD.SKIP], undefined, this.info.silent ? ANSWER_MS : 120000);
    await this.send(CMD.ACK);
    if (answer.cmd === CMD.SKIP) {
      const reason = answer.data[0];
      if (reason === SKIPPED) { this.log(`The calculator skipped ${varName(v)}.`); return false; }
      throw new Refused(SKIP_REASONS[reason] ?? `The calculator refused ${varName(v)} (reason ${reason}).`);
    }
    const data = () => this.send(CMD.DATA, v.data);
    await data();
    // A big variable takes a while at 9600 baud: about a millisecond a byte.
    await this.expect([CMD.ACK], data, ANSWER_MS + v.data.length * 2);
    if (this.info.silent) {
      await this.send(CMD.EOT);
      // libticalcs doesn't wait for an answer here; one that comes anyway mustn't be read as the next ACK.
      await this.reader.packet(500).catch(() => undefined);
    }
    return true;
  }

  /**
   * Sends one variable, trying again (after letting the line go quiet) when it times out or comes
   * back garbled. A refusal (memory full, an old OS) isn't tried again: it would only be refused again.
   */
  async sendVar(v: TiVar): Promise<boolean> {
    for (let attempt = 1; ; attempt++) {
      try {
        const sent = await this.sendVarOnce(v);
        if (sent && (v.type === 0x05 || v.type === 0x06)) this.sent.set(varName(v), v);
        return sent;
      } catch (err) {
        if (err instanceof Refused || attempt >= TRIES) throw err;
        this.log(`${varName(v)}: ${err instanceof Error ? err.message : err} Trying again (${attempt + 1} of ${TRIES})…`);
        await new Promise(r => setTimeout(r, 400 * attempt));
        await this.reader.drain();
      }
    }
  }

  /**
   * Sends every variable in a file. If one fails, the error says which and how far it got, and
   * sending the same file again goes on from there.
   */
  async sendFile(name: string, bytes: Uint8Array) {
    const { signature, vars } = parseVarFile(bytes, name);
    if (!this.fits(signature)) {
      throw new Error(`${name} is for a different calculator than the ${this.model}. TI-83 Plus and TI-84 Plus files are .8x?, TI-83 files .83?, TI-82 files .82? and TI-73 files .73?.`);
    }
    const key = `${name}:${bytes.length}:${checksum(bytes)}`;
    const from = this.stopped?.key === key ? this.stopped.at : 0;
    if (from) this.log(`Going on with ${name} from ${varName(vars[from])} (${from + 1} of ${vars.length}), where it stopped.`);
    let skipped = 0;
    for (let i = from; i < vars.length; i++) {
      try {
        if (!(await this.sendVar(vars[i]))) skipped++;
      } catch (err) {
        this.stopped = { key, at: i };
        const why = err instanceof Error ? err.message : String(err);
        throw new Error(vars.length > 1
          ? `${varName(vars[i])} (${i + 1} of ${vars.length}) didn't go: ${why} ${i ? `The ${i} before it did. ` : ""}Send ${name} again to go on from there.`
          : why);
      }
    }
    this.stopped = null;
    // Manually, one EOT ends the whole transfer.
    if (!this.info.silent) {
      await this.send(CMD.EOT);
      await this.expect([CMD.ACK]);
    }
    if (skipped === vars.length - from) throw new Error(`The calculator skipped ${vars.length === 1 ? varName(vars[0]) : `every variable in ${name}`}.`);
  }

  // ── Remote control ──

  /** Presses one key: ACK when the calculator gets it and, but on the TI-83, ACK again once it's acted on it. */
  async sendKey(code: number, settleMs = ANSWER_MS) {
    if (!this.remote) throw new Error("The TI-82 can't be controlled over the cable: use its keys.");
    await this.link.write(Uint8Array.of(this.info.pc, CMD.KEY, code & 0xff, code >> 8));
    await this.expect([CMD.ACK]);
    if (this.model !== "TI-83") await this.expect([CMD.ACK], undefined, settleMs);
  }

  /** Back to an empty home screen: Quit, Clear, Clear (as libticalcs does). */
  private async home() {
    await new Promise(r => setTimeout(r, 200));
    await this.sendKey(KEY.quit);
    await this.sendKey(KEY.clear);
    await this.sendKey(KEY.clear);
  }

  private async typeChars(text: string) {
    for (const c of text.toUpperCase()) {
      const code = charKey(c);
      if (code) await this.sendKey(code);
    }
  }

  /** Starts a program, as libticalcs's execute does: home screen, then prgm (Asm( first for assembly), its name and Enter. */
  async run(name: string) {
    if (!this.remote) throw new Error(`Start it on the calculator: prgm, then ${name.toUpperCase()}. The TI-82 can't be started over the cable.`);
    const target = name.toUpperCase();
    const v = this.sent.get(target);
    if (v && isAsm(v) && this.model === "TI-73") throw new Error("The TI-73 can't start assembly programs over the cable: use its keys.");
    await this.home();
    if (v && isAsm(v)) {
      if (this.model === "TI-83") { await this.sendKey(KEY.sendMbl); await this.sendKey(charKey("9")); }
      else await this.sendKey(KEY.asm);
    }
    await this.sendKey(KEY.exec);
    await this.typeChars(target);
    // Enter starts it: the second ACK comes when the program is done, which may be a while, or never
    // for one that waits for keys. Not hearing back means it's running.
    await this.sendKey(KEY.enter, 1500).catch(err => { if (!(err instanceof LinkTimeout)) throw err; });
  }

  /** Opens an app from the apps menu: apps, the name's first letter (which jumps there) and Enter. */
  async openApp(name: string) {
    if (!this.info.long) throw new Error("app.open works on the TI-83 Plus and TI-84 Plus.");
    await this.home();
    await this.sendKey(KEY.apps);
    const first = charKey(name.charAt(0).toUpperCase());
    if (first) await this.sendKey(first);
    await this.sendKey(KEY.enter, 1500).catch(err => { if (!(err instanceof LinkTimeout)) throw err; });
  }

  /** Types letters and digits, as key.type does. */
  type(text: string) { return this.typeChars(text); }

  /** Presses a key by its name on the keypad (enter, clear, prgm, up, 5, A…), as key.press does. */
  async press(name: string) {
    const lower = name.toLowerCase();
    if (NOT_A_KEY.has(lower)) return; // 2nd and alpha only change the next key; on isn't a key to TI-OS
    const code = KEY_NAMES[lower] ?? charKey(name.toUpperCase());
    if (!code) throw new Error(`key.press doesn't know "${name}" on a real calculator. Use a key name such as enter, clear, prgm, up or 5.`);
    await this.sendKey(code);
  }

  close() { return this.link.close(); }
}

// ── Finding out which calculator is on a cable, as libticalcs's probe does ──

/**
 * Asks a cable which calculator is on it. The TI-83 Plus family and the TI-73 answer RDY sent to
 * any calculator (machine ID 0) with their own ID; the others answer a screenshot request only when
 * asked by their own ID, tried in libticalcs's order (TI-73 before TI-83, TI-83 before TI-82). Null
 * if nothing answered, which also means no calculator is on that cable (or it's off).
 */
export async function detectModel(link: ByteLink, log: (text: string) => void = () => {}): Promise<DbusModel | null> {
  const reader = new Reader(link);
  const ask = async (mid: number, cmd: number): Promise<Packet | null> => {
    await reader.drain(150);
    await link.write(Uint8Array.of(mid, cmd, 0, 0));
    try { return await reader.packet(1200); } catch { return null; }
  };
  const flash = await ask(0x00, CMD.RDY);
  if (flash?.cmd === CMD.ACK) {
    if (flash.mid === 0x73) { log("A TI-83 Plus or TI-84 Plus answered."); return "TI-84 Plus"; }
    if (flash.mid === 0x74) { log("A TI-73 answered."); return "TI-73"; }
  }
  // A screenshot request: the one that answers then sends its screen, which is read and acknowledged.
  const shot = async (pc: number, calc: number) => {
    const p = await ask(pc, CMD.SCR);
    if (p?.cmd !== CMD.ACK || p.mid !== calc) return false;
    const screen = await reader.packet(4000).catch(() => null);
    if (screen?.cmd === CMD.DATA) await link.write(Uint8Array.of(pc, CMD.ACK, 0, 0));
    await reader.drain(200);
    return true;
  };
  if (await shot(0x07, 0x74)) { log("A TI-73 answered."); return "TI-73"; }
  if (await shot(0x03, 0x83)) { log("A TI-83 answered."); return "TI-83"; }
  // As libticalcs does: the TI-82 is asked with the TI-83's ID, and answers with its own.
  if (await shot(0x03, 0x82)) { log("A TI-82 answered."); return "TI-82"; }
  // The TI-85 and 86 answer as themselves; TIde's link doesn't support them.
  for (const [pc, calc, name] of [[0x06, 0x86, "TI-86"], [0x05, 0x85, "TI-85"]] as const) {
    if (await shot(pc, calc)) throw new Error(`A ${name} is on this cable. TIde's serial link doesn't support it yet.`);
  }
  return null;
}
