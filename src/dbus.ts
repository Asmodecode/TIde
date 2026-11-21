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

const CMD = { VAR: 0x06, CTS: 0x09, DATA: 0x15, SKIP: 0x36, ACK: 0x56, ERR: 0x5a, RDY: 0x68, EOT: 0x92, RTS: 0xc9 } as const;
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
    if (sum !== (body[len] | (body[len + 1] << 8))) throw new Error("A packet from the calculator was damaged on the way.");
    return { mid: head[0], cmd, len, data: data.slice() };
  }
}

class LinkTimeout extends Error {
  constructor() { super("The calculator didn't answer. Is it on, at the home screen, and is the cable plugged in all the way?"); }
}

/** How long the calculator gets to answer. */
const ANSWER_MS = 4000;

/** A connection to one calculator over a byte link. */
export class DbusLink {
  private reader: Reader;
  private info: ModelInfo;
  constructor(private link: ByteLink, readonly model: DbusModel, private log: (text: string) => void = () => {}) {
    this.reader = new Reader(link);
    this.info = MODELS[model];
  }

  private async send(cmd: number, data?: Uint8Array) {
    await this.link.write(packet(this.info.pc, cmd, data));
  }

  /** The next packet, which must be one of `want`; ERR resends `resend`. */
  private async expect(want: number[], resend?: () => Promise<void>, timeoutMs = ANSWER_MS): Promise<Packet> {
    for (let tries = 0; ; tries++) {
      const p = await this.reader.packet(timeoutMs);
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

  /** Sends one variable. Returns false if the calculator skipped it. */
  async sendVar(v: TiVar): Promise<boolean> {
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
      throw new Error(SKIP_REASONS[reason] ?? `The calculator refused ${varName(v)} (reason ${reason}).`);
    }
    const data = () => this.send(CMD.DATA, v.data);
    await data();
    await this.expect([CMD.ACK], data);
    if (this.info.silent) {
      await this.send(CMD.EOT);
      // libticalcs doesn't wait for an answer here; one that comes anyway mustn't be read as the next ACK.
      await this.reader.packet(500).catch(() => undefined);
    }
    return true;
  }

  /** Sends every variable in a file. */
  async sendFile(name: string, bytes: Uint8Array) {
    const { signature, vars } = parseVarFile(bytes, name);
    if (!this.fits(signature)) {
      throw new Error(`${name} is for a different calculator than the ${this.model}. TI-83 Plus and TI-84 Plus files are .8x?, TI-83 files .83?, TI-82 files .82? and TI-73 files .73?.`);
    }
    let skipped = 0;
    for (const v of vars) if (!(await this.sendVar(v))) skipped++;
    // Manually, one EOT ends the whole transfer.
    if (!this.info.silent) {
      await this.send(CMD.EOT);
      await this.expect([CMD.ACK]);
    }
    if (skipped === vars.length) throw new Error(`The calculator skipped ${vars.length === 1 ? varName(vars[0]) : `every variable in ${name}`}.`);
  }

  close() { return this.link.close(); }
}
