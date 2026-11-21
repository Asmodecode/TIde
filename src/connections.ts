// The connections popup: every way TIde can reach a real calculator, in one list, whatever the
// protocol:
// - USB: calculators with a USB port and the SilverLink cable, through TILP's libraries (link.ts);
// - serial: serial ports with a TI-Graph Link, through TIde's own link protocol (dbus.ts, serial.ts);
// - a TI device TILP doesn't know, which may be a TI-84 Evo: TIde can only describe it (evo.ts).
// In the desktop app it lists everything plugged in. A browser only lets a page see devices it was
// given before, so there "Allow a USB device…" and "Allow a serial port…" ask with the browser's own
// prompt, and what's allowed joins the list.
import { isTauri } from "@tauri-apps/api/core";
import { installUsbShim, TI } from "./usb-shim";
import { openSerialPort, webSerial, type WebSerialPort } from "./serial";
import { DBUS_MODELS, detectModel, type DbusModel } from "./dbus";
import { KNOWN_TI_USB } from "./evo";
import type { USBDeviceLike } from "./link";

export type Connection =
  | { kind: "usb"; device: USBDeviceLike; label: string }
  /** "auto": ask the calculator which it is when connecting (dbus.ts's detectModel). */
  | { kind: "serial"; port: WebSerialPort; label: string; model: DbusModel | "auto" }
  | { kind: "evo"; device: USBDeviceLike; label: string };

interface WebUsb {
  getDevices(): Promise<USBDeviceLike[]>;
  requestDevice(o: unknown): Promise<USBDeviceLike>;
  /** The desktop app's only (usb-shim.ts): every TI device plugged in. */
  tideListAll?(): Promise<USBDeviceLike[]>;
}
const webUsb = () => {
  if (isTauri()) installUsbShim();
  return (navigator as unknown as { usb?: WebUsb }).usb;
};

const PID_SILVERLINK = 0xe001;
const hex = (n: number) => n.toString(16).padStart(4, "0");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

/** A connection as listed: a serial one gets its calculator when it's chosen. */
type Listed = Exclude<Connection, { kind: "serial" }> | Omit<Extract<Connection, { kind: "serial" }>, "model">;
interface Row { id: string; connection: Listed; title: string; how: string; protocol: string; note?: string }

/** Why a listing failed, for the popup to say. */
let problems: string[] = [];
const failed = (what: string) => (err: unknown) => { problems.push(`Couldn't list ${what}: ${err instanceof Error ? err.message : err}`); return []; };

/** Everything the page can reach now. */
async function listConnections(): Promise<Row[]> {
  const rows: Row[] = [];
  problems = [];
  const usb = webUsb();
  if (usb) {
    const devices = (await (usb.tideListAll?.() ?? usb.getDevices()).catch(failed("USB devices")) as USBDeviceLike[]).filter(d => d.vendorId === TI);
    devices.forEach((device, i) => {
      const ids = `USB ${hex(device.vendorId)}:${hex(device.productId)}${device.serialNumber ? `, serial ${device.serialNumber}` : ""}`;
      const known = KNOWN_TI_USB[device.productId];
      if (!known) {
        const label = device.productName ?? "TI device";
        rows.push({ id: `evo:${i}:${ids}`, connection: { kind: "evo", device, label }, title: label, how: ids,
          protocol: "Not one TILP knows: perhaps a TI-84 Evo", note: "TIde can describe it, not send to it yet" });
        return;
      }
      const silver = device.productId === PID_SILVERLINK;
      const label = silver ? "SilverLink cable" : device.productName ?? known;
      rows.push({ id: `usb:${i}:${ids}`, connection: { kind: "usb", device, label }, title: label, how: ids,
        protocol: silver ? "TI's link protocol over the SilverLink, through TILP's libraries" : "TI's USB protocol, through TILP's libraries" });
    });
  }
  const serial = webSerial();
  if (serial) {
    const ports = await (serial.tideListAll?.() ?? serial.getPorts()).catch(failed("serial ports")) as WebSerialPort[];
    ports.forEach((port, i) => {
      const info = port.getInfo();
      const name = (port as { tideName?: string }).tideName ?? (info.usbVendorId !== undefined ? `USB serial adapter ${hex(info.usbVendorId)}:${hex(info.usbProductId ?? 0)}` : "Serial port");
      rows.push({ id: `serial:${i}:${name}`, connection: { kind: "serial", port, label: name }, title: name, how: "Serial port",
        protocol: "TI's link protocol over a TI-Graph Link, through TIde's own link" });
    });
  }
  return rows;
}

/**
 * Shows every connection and resolves with the one chosen, or null if cancelled. `prefer` (from
 * tide.json's "link") picks a row to begin with: its kind, and for serial, its port and calculator.
 */
export function chooseConnection(prefer: { via?: "usb" | "serial"; port?: string; model?: string } = {}, log: (text: string) => void = () => {}): Promise<Connection | null> {
  return new Promise(resolve => {
    // Which calculator is on a serial cable: what tide.json says, or else found out by asking it.
    let model: DbusModel | "auto" = DBUS_MODELS.find(m => m === prefer.model) ?? "auto";
    /** What Find my calculator found on each serial port, by row. */
    const found = new Map<string, string>();
    /** What went wrong asking the browser for a device, shown in the list until it goes well. */
    let asked: string[] = [];
    let finding = false;
    let rows: Row[] = [];
    let shownKey = "";
    let chosen: string | null = null;
    let done = false;

    const list = el("div", { className: "chooser-list connections-list", role: "listbox", tabIndex: 0, ariaLabel: "Connections" });
    const connect = el("button", { type: "button", className: "primary", disabled: true }, "Connect");
    const cancel = el("button", { type: "button" }, "Cancel");
    const refresh = el("button", { type: "button", title: "Look again" }, "Refresh");
    const browser = !isTauri();
    const allowUsb = el("button", { type: "button", hidden: !browser || !webUsb(), title: "Your browser asks which USB device to let TIde use" }, "Allow a USB device…");
    const allowSerial = el("button", { type: "button", hidden: !browser || !webSerial(), title: "Your browser asks which serial port to let TIde use" }, "Allow a serial port…");
    const find = el("button", { type: "button", hidden: !webSerial(), title: "Try each serial port and ask what's on it" }, "Find my calculator");
    const missing = [!webUsb() && "USB (WebUSB)", !webSerial() && "serial ports (Web Serial)"].filter(Boolean);
    const dialog = el("dialog", { className: "update-dialog chooser connections" },
      el("h2", {}, "Connect a calculator"),
      el("p", { className: "hint" }, browser
        ? "Your calculator over USB, a SilverLink cable, or a serial port with a TI-Graph Link. Your browser shows TIde only the devices you allow: use the Allow buttons for a new one."
        : "Your calculator over USB, a SilverLink cable, or a serial port with a TI-Graph Link. On Windows, USB devices need the WinUSB driver (install it with Zadig, as for TILP)."),
      ...(missing.length ? [el("p", { className: "hint connections-missing" }, `This browser can't reach ${missing.join(" or ")}. Chrome and Edge can, as can the desktop app.`)] : []),
      list,
      el("div", { className: "actions" }, refresh, find, allowUsb, allowSerial, el("span", { className: "spacer" }), cancel, connect));

    const finish = (row: Row | null) => {
      if (done) return;
      done = true;
      window.clearInterval(poll);
      dialog.close();
      dialog.remove();
      if (!row) { resolve(null); return; }
      if (row.connection.kind === "serial") {
        try { localStorage.setItem("tide-pref-serial", JSON.stringify({ ...JSON.parse(localStorage.getItem("tide-pref-serial") ?? "{}"), model })); } catch { /* storage unavailable */ }
        resolve({ ...row.connection, model });
      } else resolve(row.connection);
    };
    const select = (id: string) => {
      chosen = id;
      for (const r of list.querySelectorAll<HTMLElement>("[data-id]")) r.setAttribute("aria-selected", String(r.dataset.id === id));
      const row = rows.find(r => r.id === id);
      connect.disabled = !row;
      connect.textContent = row?.connection.kind === "evo" ? "Describe it" : "Connect";
    };

    function render() {
      const trouble = [...asked, ...problems].map(p => el("p", { className: "chooser-empty connections-problem" }, p));
      if (!rows.length) {
        if (trouble.length) { list.replaceChildren(...trouble); connect.disabled = true; return; }
        list.replaceChildren(el("p", { className: "chooser-empty" }, browser
          ? "Nothing allowed yet. Plug in your calculator or cable, then use Allow a USB device… or Allow a serial port…."
          : "Nothing plugged in. Plug in your calculator or cable and turn it on; it shows up here."));
        connect.disabled = true;
        return;
      }
      list.replaceChildren(...trouble, ...rows.map(row => {
        const kids: (Node | string)[] = [
          el("div", { className: "connection-top" }, el("strong", {}, row.title), el("span", { className: `connection-kind ${row.connection.kind}` }, row.connection.kind === "serial" ? "Serial" : "USB")),
          el("span", {}, row.how),
          el("span", { className: "connection-protocol" }, row.protocol),
          ...(row.note ? [el("span", { className: "connection-note" }, row.note)] : []),
          ...(found.has(row.id) ? [el("span", { className: "connection-found" }, found.get(row.id)!)] : []),
        ];
        // Which calculator is on a serial cable: found out by asking it, or picked here.
        if (row.connection.kind === "serial") {
          const pick = el("select", { ariaLabel: "Calculator on this cable" },
            el("option", { value: "auto" }, "Find out (ask it)"), ...DBUS_MODELS.map(m => el("option", { value: m }, m)));
          pick.value = model;
          pick.addEventListener("change", () => { model = pick.value as DbusModel | "auto"; });
          pick.addEventListener("click", e => e.stopPropagation());
          kids.push(el("label", { className: "connection-model" }, "Calculator ", pick));
        }
        const r = el("div", { className: "chooser-item connection", role: "option", tabIndex: -1 }, ...kids);
        r.dataset.id = row.id;
        r.addEventListener("click", () => select(row.id));
        r.addEventListener("dblclick", e => { if (!(e.target instanceof HTMLSelectElement)) finish(row); });
        return r;
      }));
      // Keep the choice; otherwise what tide.json names; otherwise the first.
      const preferred = rows.find(r => r.connection.kind === prefer.via && (prefer.via !== "serial" || !prefer.port || r.title.startsWith(prefer.port)));
      select(rows.some(r => r.id === chosen) ? chosen! : (preferred ?? rows[0]).id);
    }

    async function load() {
      const next = await listConnections();
      if (done) return;
      // Redraw only when something came or went (or a listing failed), so a model picker that's open stays open.
      const key = [...next.map(r => r.id), ...problems, ...asked, ...found.values()].join("|");
      if (key === shownKey) return;
      shownKey = key;
      rows = next;
      render();
    }

    list.addEventListener("keydown", e => {
      if (e.target instanceof HTMLSelectElement) return;
      const at = rows.findIndex(r => r.id === chosen);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) { select(next.id); list.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" }); }
      } else if (e.key === "Enter" && at >= 0) { e.preventDefault(); finish(rows[at]); }
    });
    connect.addEventListener("click", () => finish(rows.find(r => r.id === chosen) ?? null));
    cancel.addEventListener("click", () => finish(null));
    refresh.addEventListener("click", () => { shownKey = ""; void load(); });
    // Find my calculator: open each serial port in turn, ask what's on it, and pick the first that answers.
    find.addEventListener("click", async () => {
      if (finding) return;
      finding = true;
      find.disabled = connect.disabled = true;
      find.textContent = "Looking…";
      let first: Row | null = null;
      for (const row of rows.filter(r => r.connection.kind === "serial")) {
        found.set(row.id, "Asking…");
        render();
        try {
          const link = await openSerialPort((row.connection as { port: WebSerialPort }).port);
          try {
            const answered = await detectModel(link);
            found.set(row.id, answered ? `${answered === "TI-84 Plus" ? "A TI-83 Plus or TI-84 Plus" : `A ${answered}`} answered here.` : "Nothing answered here.");
            if (answered && !first) { first = row; model = answered; }
          } finally {
            await link.close().catch(() => {});
          }
        } catch (err) {
          found.set(row.id, `Couldn't try it: ${err instanceof Error ? err.message : err}`);
        }
        if (done) return;
      }
      finding = false;
      find.disabled = false;
      find.textContent = "Find my calculator";
      if (first) chosen = first.id;
      shownKey = "";
      render();
      connect.disabled = !chosen;
    });
    // The browser's own prompts, from these clicks.
    // The browser's own prompts, from these clicks. Cancelling one is fine; anything else is said here.
    const failedAsk = (what: string, err: unknown) => {
      const e = err as { name?: string; message?: string };
      if (e.name === "NotFoundError") return; // nothing picked
      asked = [`Your browser didn't give TIde the ${what}: ${e.name ?? "Error"}: ${e.message ?? err}`];
      log(asked[0]);
    };
    allowUsb.addEventListener("click", async () => {
      asked = [];
      try {
        const device = await webUsb()!.requestDevice({ filters: [{ vendorId: TI }] });
        const ids = `${hex(device.vendorId)}:${hex(device.productId)}`;
        log(`The browser gave TIde ${device.productName ?? "a USB device"} (USB ${ids}).`);
        const listed = (await webUsb()!.getDevices().catch(() => [])).filter(d => d.vendorId === TI);
        log(`Devices the browser now lets TIde see: ${listed.map(d => `${d.productName ?? "?"} (${hex(d.vendorId)}:${hex(d.productId)})`).join(", ") || "none"}.`);
        if (!listed.includes(device)) asked = [`Your browser gave TIde ${device.productName ?? "the device"} (USB ${ids}) but doesn't list it. Unplug it, plug it in again, and Refresh.`];
      } catch (err) { failedAsk("USB device", err); }
      shownKey = "";
      await load();
    });
    allowSerial.addEventListener("click", async () => {
      asked = [];
      try { await webSerial()!.requestPort(); } catch (err) { failedAsk("serial port", err); }
      shownKey = "";
      await load();
    });
    dialog.addEventListener("cancel", e => { e.preventDefault(); finish(null); }); // Escape
    // Devices come and go while it's open.
    const poll = window.setInterval(() => void load(), 2000);

    document.body.append(dialog);
    dialog.showModal();
    list.focus();
    render();
    void load();
  });
}
