// Web Serial for the desktop app. Its web view has no navigator.serial, so installSerialShim() gives
// the page one, made of the app's serial commands (src-tauri/src/serial.rs), with TIde's own port
// chooser (chooser.ts) for requestPort(). The calculator link (serial.ts) then uses Web Serial the
// same way in the app as in Chrome or Edge. It covers what that needs: requestPort, getPorts, and a
// port's open, setSignals, readable, writable, getInfo and close.
import { invoke } from "@tauri-apps/api/core";
import { chooseDevice } from "./chooser";

interface PortInfo { path: string; description: string; usbVendorId: number | null; usbProductId: number | null; serialNumber: string | null }
interface Filter { usbVendorId?: number; usbProductId?: number }
interface OpenOptions { baudRate: number; dataBits?: number; stopBits?: number; parity?: string; flowControl?: string }

const hex = (n: number) => n.toString(16).padStart(4, "0");

/** A port, as Web Serial's SerialPort. One open at a time, as the app holds one. */
class AppSerialPort {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  private open_ = false;
  constructor(readonly info: PortInfo) {}

  getInfo() {
    return { usbVendorId: this.info.usbVendorId ?? undefined, usbProductId: this.info.usbProductId ?? undefined };
  }

  async open(options: OpenOptions) {
    if (this.open_) throw new DOMException("The port is already open.", "InvalidStateError");
    await invoke("serial_open", { path: this.info.path, options });
    this.open_ = true;
    // Reads: the app waits up to a quarter second at a time, so closing is never held up for long.
    this.readable = new ReadableStream<Uint8Array>({
      pull: async controller => {
        while (this.open_) {
          let bytes: Uint8Array;
          try {
            bytes = new Uint8Array(await invoke<ArrayBuffer>("serial_read", { max: 4096, timeout: 250 }));
          } catch (err) {
            controller.error(new DOMException(`The serial port stopped: ${err}`, "NetworkError"));
            return;
          }
          if (bytes.length) { controller.enqueue(bytes); return; }
        }
        controller.close();
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: async chunk => { await invoke("serial_write", chunk, { headers: {} }); },
    });
  }

  async setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }) {
    await invoke("serial_signals", { dtr: signals.dataTerminalReady ?? null, rts: signals.requestToSend ?? null });
  }

  async close() {
    if (!this.open_) return;
    this.open_ = false;
    this.readable = null;
    this.writable = null;
    await invoke("serial_close");
  }

  async forget() { await this.close(); }
}

/** Gives the desktop app's page a navigator.serial. */
export function installSerialShim() {
  if ((navigator as { serial?: unknown }).serial) return;
  const granted = new Map<string, AppSerialPort>();
  const portFor = (info: PortInfo) => {
    let port = granted.get(info.path);
    if (!port) granted.set(info.path, port = new AppSerialPort(info));
    return port;
  };
  const serial = {
    async getPorts() { return [...granted.values()]; },
    /** TIde's port chooser, in place of the browser's. `preselect` is TIde's own: a path to start on. */
    async requestPort(options: { filters?: Filter[]; preselect?: string } = {}) {
      const matches = (p: PortInfo) => !options.filters?.length || options.filters.some(f =>
        (f.usbVendorId === undefined || f.usbVendorId === p.usbVendorId) && (f.usbProductId === undefined || f.usbProductId === p.usbProductId));
      let found: PortInfo[] = [];
      const id = await chooseDevice({
        title: "Connect to a serial port",
        hint: "Pick the port your calculator's cable is on: a TI-Graph Link, or a USB-to-serial adapter with one.",
        empty: "No serial ports found. Plug the cable in, then Refresh.",
        preselect: options.preselect,
        list: async () => {
          found = (await invoke<PortInfo[]>("serial_ports")).filter(matches);
          return found.map(p => ({
            id: p.path,
            label: p.description ? `${p.path}: ${p.description}` : p.path,
            detail: p.usbVendorId !== null ? `USB ${hex(p.usbVendorId)}:${hex(p.usbProductId ?? 0)}${p.serialNumber ? `, serial ${p.serialNumber}` : ""}` : undefined,
          }));
        },
      });
      const info = found.find(p => p.path === id);
      if (!info) throw new DOMException("No port selected by the user.", "NotFoundError");
      return portFor(info);
    },
    addEventListener() { /* connect and disconnect events aren't reported */ },
    removeEventListener() {},
  };
  Object.defineProperty(navigator, "serial", { value: serial, configurable: true });
}
