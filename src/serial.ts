// Serial ports for the calculator link (dbus.ts): the desktop app's (src-tauri/src/serial.rs, with
// the serialport crate), or the browser's Web Serial in Chrome and Edge. Both open TI's grey
// TI-Graph Link the way it needs: 9600 baud, 8 data bits, no parity, 1 stop bit, no flow control,
// with DTR and RTS on to power it.
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ByteLink } from "./dbus";

export const GRAY_LINK_BAUD = 9600;

export interface PortChoice { path: string; description: string }

/** Whether this app can use serial ports, or why not. */
export function serialSupport(): string | null {
  if (isTauri()) return null;
  return "serial" in navigator ? null : "This browser has no Web Serial. Use Chrome or Edge, or the desktop app.";
}

/** The desktop app's serial ports. In a browser, the port is picked in its own chooser instead (null). */
export async function listPorts(): Promise<PortChoice[] | null> {
  if (!isTauri()) return null;
  return invoke<PortChoice[]>("serial_ports");
}

/** Opens a port: by path in the desktop app; in a browser, the one picked in its chooser (call from a click). */
export async function openPort(path: string | null, baud = GRAY_LINK_BAUD): Promise<ByteLink> {
  if (isTauri()) {
    if (!path) throw new Error("Choose a serial port.");
    await invoke("serial_open", { path, baud });
    return {
      name: path,
      write: async bytes => { await invoke("serial_write", bytes, { headers: {} }); },
      read: async (max, timeoutMs) => new Uint8Array(await invoke<ArrayBuffer>("serial_read", { max, timeout: Math.ceil(timeoutMs) })),
      close: async () => { await invoke("serial_close"); },
    };
  }
  return openWebSerial(baud);
}

// ── Web Serial ──
interface WebSerialPort {
  open(options: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string; flowControl?: string }): Promise<void>;
  setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

async function openWebSerial(baud: number): Promise<ByteLink> {
  const serial = (navigator as unknown as { serial?: { requestPort(): Promise<WebSerialPort> } }).serial;
  if (!serial) throw new Error(serialSupport()!);
  let port: WebSerialPort;
  try { port = await serial.requestPort(); } catch (err) {
    if ((err as { name?: string }).name === "NotFoundError") throw new Error("No serial port was chosen.");
    throw err;
  }
  await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
  await port.setSignals({ dataTerminalReady: true, requestToSend: true });
  await new Promise(r => setTimeout(r, 150));

  // One reader for the port's life: what arrives waits in `held` for read().
  const reader = port.readable!.getReader();
  const writer = port.writable!.getWriter();
  let held = new Uint8Array(0);
  const waiter: { wake: (() => void) | null } = { wake: null };
  let closed = false;
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.length) {
          const joined = new Uint8Array(held.length + value.length);
          joined.set(held); joined.set(value, held.length);
          held = joined;
          waiter.wake?.();
        }
      }
    } catch { /* the port closed or the cable came out */ }
    closed = true;
    waiter.wake?.();
  })();
  // The first bytes after power-up are noise.
  held = new Uint8Array(0);
  const info = port.getInfo();
  return {
    name: info.usbVendorId ? `USB serial ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}` : "serial port",
    write: bytes => writer.write(bytes),
    async read(max, timeoutMs) {
      if (!held.length && !closed) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { waiter.wake = null; resolve(); }, timeoutMs);
          waiter.wake = () => { clearTimeout(timer); waiter.wake = null; resolve(); };
        });
      }
      if (!held.length && closed) throw new Error("The serial port closed. Is the cable still plugged in?");
      const out = held.slice(0, max);
      held = held.slice(out.length);
      return out;
    },
    async close() {
      closed = true;
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      await writer.close().catch(() => {});
      writer.releaseLock();
      await port.close().catch(() => {});
    },
  };
}
