// Serial ports for the calculator link (dbus.ts), through Web Serial everywhere: the browser's in
// Chrome and Edge, and in the desktop app the one serial-shim.ts gives it (TIde's port chooser,
// with the app's serial commands under it). Both open TI's grey TI-Graph Link the way it needs:
// 9600 baud, 8 data bits, no parity, 1 stop bit, no flow control, with DTR and RTS on to power it.
import { isTauri } from "@tauri-apps/api/core";
import type { ByteLink } from "./dbus";
import { installSerialShim } from "./serial-shim";

export const GRAY_LINK_BAUD = 9600;

export interface WebSerialPort {
  open(options: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string; flowControl?: string }): Promise<void>;
  setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}
export interface WebSerial {
  requestPort(options?: { filters?: unknown[]; preselect?: string }): Promise<WebSerialPort>;
  getPorts(): Promise<WebSerialPort[]>;
  /** The desktop app's only (serial-shim.ts): every port, not just those allowed already. */
  tideListAll?(): Promise<WebSerialPort[]>;
}

export const webSerial = () => {
  if (isTauri()) installSerialShim();
  return (navigator as unknown as { serial?: WebSerial }).serial;
};

/** Whether serial ports can be used here, or why not. */
export function serialSupport(): string | null {
  return webSerial() ? null : "This browser has no Web Serial. Use Chrome or Edge, or the desktop app.";
}

/**
 * Asks which port to use and opens it. Call it from a click: a browser only shows its chooser for
 * one. `preselect` (such as tide.json's link.port) starts the desktop app's chooser on that port.
 */
export async function openPort(preselect?: string, baud = GRAY_LINK_BAUD): Promise<ByteLink> {
  const serial = webSerial();
  if (!serial) throw new Error(serialSupport()!);
  let port: WebSerialPort;
  try { port = await serial.requestPort({ preselect }); } catch (err) {
    if ((err as { name?: string }).name === "NotFoundError") throw new Error("No serial port was chosen.");
    throw err;
  }
  return openSerialPort(port, baud);
}

/** Opens a port already chosen (in the connections popup) for the calculator link. */
export async function openSerialPort(port: WebSerialPort, baud = GRAY_LINK_BAUD): Promise<ByteLink> {
  await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
  await port.setSignals({ dataTerminalReady: true, requestToSend: true });
  // The cable takes a moment to power up.
  await new Promise(r => setTimeout(r, 150));

  // One reader for the port's life: what arrives waits in `held` for read().
  const reader = port.readable!.getReader();
  const writer = port.writable!.getWriter();
  let held = new Uint8Array(0);
  const waiter: { wake: (() => void) | null } = { wake: null };
  let closed = false;
  let started = false;
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        // Anything from before the first write is power-up noise.
        if (value?.length && started) {
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
  const info = port.getInfo();
  return {
    // The desktop app knows the port's own name (COM3); a browser only its USB IDs.
    name: (port as { tidePath?: string }).tidePath ?? (info.usbVendorId !== undefined ? `USB serial ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}` : "the serial port"),
    write: bytes => { started = true; return writer.write(bytes); },
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
