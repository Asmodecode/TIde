// WebUSB for the calculator link (link.ts). WebTILP's library uses libusb, whose WebAssembly
// build talks to devices through the browser's navigator.usb.
// - In the desktop app the web view has no WebUSB, so installUsbShim() gives the page one, backed by
//   the app's USB commands (src-tauri/src/link.rs): TI's devices only, picked in TIde's own chooser
//   (chooser.ts), as a browser would ask.
// - Everywhere, withReadTimeouts() gives a device's reads a time limit. libusb can't cancel a WebUSB
//   read, so one the calculator never answers would wait forever; this ends it after a while with no
//   data, and keeps it, so data that arrives later goes to the next read instead of being lost.
import { invoke } from "@tauri-apps/api/core";
import { chooseDevice } from "./chooser";

const TI = 0x0451;
/** Longer than TILP's own time limits, so it gives up first, as with a real cable. */
const READ_LIMIT_MS = 6000;

interface Info { id: string; vendorId: number; productId: number; productName: string | null; manufacturerName: string | null; serialNumber: string | null }
interface Descriptors { device: number[]; configurations: number[][]; active: number }
type Setup = { requestType: string; recipient: string; request: number; value: number; index: number };
const ok = (data?: Uint8Array) => ({ status: "ok", data: data ? new DataView(data.buffer, data.byteOffset, data.byteLength) : undefined });
const bytesOf = (data: BufferSource) => (ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data)).slice();

/** WebUSB's view of a configuration descriptor. */
function parseConfiguration(raw: number[]) {
  const interfaces: { interfaceNumber: number; alternate: unknown; alternates: unknown[]; claimed: boolean }[] = [];
  let alternates: { alternateSetting: number; interfaceClass: number; interfaceSubclass: number; interfaceProtocol: number; interfaceName: null; endpoints: unknown[] } | null = null;
  for (let i = 0; i + 1 < raw.length && raw[i] > 0; i += raw[i]) {
    const type = raw[i + 1];
    if (type === 4) {
      const number = raw[i + 2];
      alternates = { alternateSetting: raw[i + 3], interfaceClass: raw[i + 5], interfaceSubclass: raw[i + 6], interfaceProtocol: raw[i + 7], interfaceName: null, endpoints: [] };
      let iface = interfaces.find(f => f.interfaceNumber === number);
      if (!iface) interfaces.push(iface = { interfaceNumber: number, alternate: alternates, alternates: [], claimed: false });
      iface.alternates.push(alternates);
    } else if (type === 5 && alternates) {
      const address = raw[i + 2], attributes = raw[i + 3];
      alternates.endpoints.push({
        endpointNumber: address & 0x0f, direction: address & 0x80 ? "in" : "out",
        type: ["control", "isochronous", "bulk", "interrupt"][attributes & 3], packetSize: raw[i + 4] | (raw[i + 5] << 8),
      });
    }
  }
  return { configurationValue: raw[5], configurationName: null, interfaces };
}

/** A TI device, as WebUSB's USBDevice, through the app's USB commands. */
class AppUsbDevice {
  opened = false;
  configuration: ReturnType<typeof parseConfiguration> | null = null;
  configurations: ReturnType<typeof parseConfiguration>[] = [];
  readonly vendorId: number; readonly productId: number;
  readonly productName?: string; readonly manufacturerName?: string; readonly serialNumber?: string;
  private raw: Descriptors | null = null;
  constructor(readonly info: Info) {
    this.vendorId = info.vendorId; this.productId = info.productId;
    this.productName = info.productName ?? undefined; this.manufacturerName = info.manufacturerName ?? undefined; this.serialNumber = info.serialNumber ?? undefined;
  }
  async open() {
    this.raw = await invoke<Descriptors>("link_open", { id: this.info.id });
    this.configurations = this.raw.configurations.map(parseConfiguration);
    this.configuration = this.configurations.find(c => c.configurationValue === this.raw!.active) ?? this.configurations[0] ?? null;
    this.opened = true;
  }
  async close() { this.opened = false; await invoke("link_close"); }
  async selectConfiguration(value: number) {
    await invoke("link_set_configuration", { value });
    this.configuration = this.configurations.find(c => c.configurationValue === value) ?? this.configuration;
  }
  private iface(n: number) { return this.configuration?.interfaces.find(f => f.interfaceNumber === n); }
  async claimInterface(interfaceNumber: number) { await invoke("link_claim", { interface: interfaceNumber }); const f = this.iface(interfaceNumber); if (f) f.claimed = true; }
  async releaseInterface(interfaceNumber: number) { await invoke("link_release", { interface: interfaceNumber }); const f = this.iface(interfaceNumber); if (f) f.claimed = false; }
  async selectAlternateInterface(interfaceNumber: number, alternate: number) { await invoke("link_alternate", { interface: interfaceNumber, alternate }); }
  async controlTransferIn(setup: Setup, length: number) {
    // Descriptors come from those read when the device was opened (Windows answers no other way).
    if (setup.requestType === "standard" && setup.recipient === "device" && setup.request === 6 && this.raw) {
      const type = setup.value >> 8, index = setup.value & 0xff;
      if (type === 1) return ok(new Uint8Array(this.raw.device).slice(0, length));
      if (type === 2) return ok(new Uint8Array(this.raw.configurations[index] ?? []).slice(0, length));
      if (type === 3) return ok(new Uint8Array(await invoke<ArrayBuffer>("link_string", { index, language: setup.index })).slice(0, length));
    }
    return ok(new Uint8Array(await invoke<ArrayBuffer>("link_control_in", { setup, length })));
  }
  async controlTransferOut(setup: Setup, data?: BufferSource) {
    const bytesWritten = await invoke<number>("link_control_out", { setup, data: Array.from(data ? bytesOf(data) : []) });
    return { status: "ok", bytesWritten };
  }
  /** One wait at a time; the shared time limit is withReadTimeouts'. */
  async transferIn(endpointNumber: number, length: number) {
    for (;;) {
      const result = new Uint8Array(await invoke<ArrayBuffer>("link_transfer_in", { endpoint: endpointNumber, length, timeout: 500 }));
      if (result[0] === 1) return ok(result.slice(1));
      if (!this.opened) return { status: "ok", data: new DataView(new ArrayBuffer(0)) };
    }
  }
  async transferOut(endpointNumber: number, data: BufferSource) {
    const bytesWritten = await invoke<number>("link_transfer_out", bytesOf(data), { headers: { "x-tide-endpoint": String(endpointNumber) } });
    return { status: "ok", bytesWritten };
  }
  async clearHalt(direction: "in" | "out", endpointNumber: number) { await invoke("link_clear_halt", { endpoint: endpointNumber, inward: direction === "in" }); }
  async reset() { await invoke("link_reset"); }
  async forget() { /* nothing is remembered */ }
}

/** Gives the desktop app's page a navigator.usb for TI's devices. */
export function installUsbShim() {
  if ((navigator as { usb?: unknown }).usb) return;
  const known = new Map<string, AppUsbDevice>();
  const granted = new Set<AppUsbDevice>();
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const list = async () => {
    const infos = await invoke<Info[]>("link_devices");
    for (const [id, device] of known) {
      if (!infos.some(i => i.id === id)) {
        known.delete(id); granted.delete(device);
        listeners.get("disconnect")?.forEach(l => l({ device }));
      }
    }
    return infos.map(info => { let d = known.get(info.id); if (!d) known.set(info.id, d = new AppUsbDevice(info)); return d; });
  };
  const usb = {
    async getDevices() { await list(); return [...granted]; },
    /** TIde's chooser, in place of the browser's: the TI devices that match the filters. */
    async requestDevice(options: { filters?: { vendorId?: number; productId?: number }[] } = {}) {
      const filters = options.filters?.length ? options.filters : [{}];
      const matching = async () => (await list()).filter(d => filters.some(f => (f.vendorId ?? d.vendorId) === d.vendorId && (f.productId ?? d.productId) === d.productId));
      const hex = (n: number) => n.toString(16).padStart(4, "0");
      let shown: AppUsbDevice[] = [];
      const id = await chooseDevice({
        title: "Connect to a calculator",
        hint: "Pick the calculator, or the SilverLink cable, plugged in over USB. On Windows it needs the WinUSB driver (install it with Zadig, as for TILP).",
        empty: "No TI calculator or link cable is plugged in. Plug it in and turn it on, then Refresh.",
        list: async () => {
          shown = await matching();
          return shown.map(d => ({
            id: d.info.id,
            label: d.productName ?? "TI device",
            detail: `USB ${hex(d.vendorId)}:${hex(d.productId)}${d.serialNumber ? `, serial ${d.serialNumber}` : ""}`,
          }));
        },
      });
      const device = shown.find(d => d.info.id === id);
      if (!device) throw Object.assign(new Error("No calculator was chosen."), { name: "NotFoundError" });
      granted.add(device);
      return device;
    },
    addEventListener(type: string, listener: (e: unknown) => void) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener); },
    removeEventListener(type: string, listener: (e: unknown) => void) { listeners.get(type)?.delete(listener); },
  };
  Object.defineProperty(navigator, "usb", { value: usb, configurable: true });
}

/** Gives a device's reads a time limit (see the top of the file). */
export function withReadTimeouts<T extends { transferIn(endpoint: number, length: number): Promise<unknown> }>(device: T): T {
  const read = device.transferIn.bind(device);
  const waiting = new Map<number, Promise<unknown>>();
  device.transferIn = async (endpoint: number, length: number) => {
    const pending = waiting.get(endpoint) ?? read(endpoint, length);
    waiting.set(endpoint, pending);
    let timer = 0;
    const late = new Promise(resolve => { timer = window.setTimeout(() => resolve(null), READ_LIMIT_MS); });
    const result = await Promise.race([pending.then(r => ({ r }), e => ({ e })), late]);
    window.clearTimeout(timer);
    if (result === null) return { status: "ok", data: new DataView(new ArrayBuffer(0)) };
    waiting.delete(endpoint);
    if ("e" in (result as object)) throw (result as { e: unknown }).e;
    return (result as { r: unknown }).r;
  };
  return device;
}

export { TI };
