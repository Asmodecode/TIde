// Sending files to a real calculator, with WebTILP's library: TILP's libraries (libticalcs and
// friends) compiled to WebAssembly (public/webtilp, see SOURCE.txt there). They know every TI
// calculator TILP does, over a USB cable (TI-84 Plus family, TI-84 Plus CE family, TI-89 Titanium,
// TI-Nspire) or the SilverLink cable (TI-73, 82, 83, 83 Plus, 85, 86, 89, 92…), and reach them
// through WebUSB (in the desktop app, usb-shim.ts's). The calls are those WebTILP's own page makes.
import { installUsbShim, withReadTimeouts, TI } from "./usb-shim";
import { isTauri } from "@tauri-apps/api/core";

interface TILibs {
  ccall(name: string, ret: string | null, types: string[], args: unknown[], opts?: { async?: boolean }): unknown;
  FS: { writeFile(path: string, data: Uint8Array): void; unlink(path: string): void; mkdirTree(path: string): void };
  _set_cable_model(model: number): void;
  _set_force_cable(force: number): void;
  _set_calc_model(model: number): void;
  _set_force_calc(force: number): void;
  _set_cable_timeout(tenths: number): void;
  _set_cable_delay(us: number): void;
}
declare const TILibsModule: (options: Record<string, unknown>) => Promise<TILibs>;

/** libticables' cable models. */
const CABLE_SILVERLINK = 4, CABLE_DIRECTLINK = 5;
const PID_SILVERLINK = 0xe001;

export interface Connected {
  /** The calculator, as libticalcs names it ("TI84+CE", "TI83+"…). */
  model: string;
  /** The cable or calculator plugged in, as USB names it. */
  device: string;
  send(name: string, bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** Calls `listener` if the calculator or cable is unplugged. */
  onLost(listener: () => void): void;
}

const base = import.meta.env.BASE_URL;
let module: Promise<TILibs> | null = null;
/** One call into the library at a time: it can only run one that waits. */
let queue: Promise<unknown> = Promise.resolve();
function call<T>(lib: TILibs, name: string, ret: string | null, types: string[], args: unknown[]): Promise<T> {
  const next = queue.then(() => lib.ccall(name, ret, types, args, { async: true }) as Promise<T>);
  queue = next.catch(() => undefined);
  return next;
}

/** Whether this browser can reach a calculator: WebUSB (or the desktop app's) and cross-origin isolation. */
export function linkSupport(): string | null {
  if (isTauri()) installUsbShim();
  if (!(navigator as { usb?: unknown }).usb) return "This browser has no WebUSB. Use Chrome or Edge, or the desktop app.";
  if (!crossOriginIsolated) return "The page isn't cross-origin isolated, which the calculator link needs. Reload it.";
  return null;
}

function load(log: (text: string, err: boolean) => void): Promise<TILibs> {
  return (module ??= (async () => {
    if (typeof TILibsModule === "undefined") {
      await new Promise<void>((resolve, reject) => {
        const script = Object.assign(document.createElement("script"), { src: `${base}webtilp/webtilp.js` });
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Couldn't load the calculator link."));
        document.head.append(script);
      });
    }
    const lib = await TILibsModule({
      locateFile: (file: string) => `${base}webtilp/${file}`,
      // TILP's libraries say a lot; only problems go to the console.
      print: () => {},
      printErr: (text: string) => { if (/error|fail|warn/i.test(text) && !/^\s*\(/.test(text)) log(`${text}\n`, true); },
    });
    await call(lib, "init", "number", [], []);
    lib._set_cable_timeout(50);
    lib._set_cable_delay(10);
    return lib;
  })().catch(err => { module = null; throw err; }));
}

let previous: Connected | null = null;

/**
 * Picks a calculator or cable and connects to it. Call it straight from a click: a browser only
 * shows its device chooser for one.
 */
export async function connect(log: (text: string, err: boolean) => void): Promise<Connected> {
  const problem = linkSupport();
  if (problem) throw new Error(problem);
  const usb = (navigator as unknown as { usb: {
    requestDevice(o: unknown): Promise<USBDeviceLike>;
    getDevices(): Promise<USBDeviceLike[]>;
    addEventListener(type: string, listener: (e: unknown) => void): void;
    removeEventListener(type: string, listener: (e: unknown) => void): void;
  } }).usb;
  // Before anything else is awaited, while the click still counts.
  const chosen = usb.requestDevice({ filters: [{ vendorId: TI }] });
  const lib = await load(log);
  let device: USBDeviceLike;
  try { device = await chosen; } catch (err) {
    if ((err as { name?: string }).name === "NotFoundError") throw new Error("No calculator was chosen. Plug it in (or the SilverLink cable, for older models) and connect again.");
    throw err;
  }
  await previous?.close().catch(() => {});
  withReadTimeouts(device);
  // libusb looks through getDevices(): only this one, so it can't pick another.
  const getDevices = usb.getDevices.bind(usb);
  usb.getDevices = async () => (await getDevices()).filter(d => d === device);
  lib._set_cable_model(device.productId === PID_SILVERLINK ? CABLE_SILVERLINK : CABLE_DIRECTLINK);
  lib._set_force_cable(1);
  lib._set_calc_model(0); // found by asking the calculator
  lib._set_force_calc(0);

  let handle = 0;
  for (let attempt = 0; !handle && attempt < 3; attempt++) {
    handle = await call<number>(lib, "create_handle", "number", [], []);
    if (!handle) await new Promise(r => setTimeout(r, 500));
  }
  if (!handle) throw new Error("The calculator link couldn't start. Unplug the calculator, plug it in again, and connect again.");
  const failure = (code: number) => lib.ccall("get_error_message", "string", ["number"], [code]) as string;
  const opened = await call<number>(lib, "open_cable", "number", ["number"], [handle]);
  if (opened) throw new Error(`Couldn't open the cable: ${failure(opened)}`);
  const ready = await call<number>(lib, "is_ready", "number", ["number"], [handle]);
  if (ready) {
    await call(lib, "close_cable", "number", ["number"], [handle]).catch(() => {});
    throw new Error(`The calculator didn't answer: ${failure(ready)} Turn it on, go to the home screen, and connect again.`);
  }
  const model = (lib.ccall("get_calc_model_string", "string", [], []) as string) || "calculator";
  log(`Connected to the ${model} (${device.productName ?? "USB"}).\n`, false);

  let closed = false;
  const lost = new Set<() => void>();
  const unplugged = (e: unknown) => {
    if ((e as { device?: unknown }).device !== device) return;
    void link.close();
    lost.forEach(listener => listener());
  };
  usb.addEventListener("disconnect", unplugged);
  const link: Connected = {
    model,
    device: device.productName ?? "USB",
    async send(name, bytes) {
      if (closed) throw new Error("The calculator isn't connected.");
      lib.FS.mkdirTree("/send");
      const path = `/send/${name.replace(/[^\w.() -]/g, "_")}`;
      lib.FS.writeFile(path, bytes);
      try {
        // No folder, each variable where its file says (RAM or archive), and the end of the
        // transfer sent at once.
        const result = await call<number>(lib, "send_file_custom", "number", ["number", "string", "string", "number", "number"], [handle, path, "", -1, 0]);
        if (result) throw new Error(failure(result));
      } finally {
        try { lib.FS.unlink(path); } catch { /* already gone */ }
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (previous === link) previous = null;
      usb.getDevices = getDevices;
      usb.removeEventListener("disconnect", unplugged);
      await call(lib, "close_cable", "number", ["number"], [handle]).catch(() => {});
    },
    onLost(listener) { lost.add(listener); },
  };
  previous = link;
  return link;
}

interface USBDeviceLike { productId: number; productName?: string; transferIn(endpoint: number, length: number): Promise<unknown> }
