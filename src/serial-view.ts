// The Serial tab: a real calculator on a serial cable (TI's grey TI-Graph Link, or a USB-to-serial
// adapter with one), through Web Serial (serial.ts) and TIde's own link protocol (dbus.ts). Connect
// opens the connections popup (connections.ts), the same one as the calculator panel's, which lists
// every connection; this tab shows the serial one, sends files dropped or picked here, and lists
// what went. Run and Send in the calculator panel use the same connection.
import type { DbusLink } from "./dbus";
import { serialSupport } from "./serial";
import { SEND_TYPES, TREE_DRAG, unbundle, type TiFile } from "./calc";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

const BUNDLE = /\.b8[34]$/i;

export interface SerialView {
  el: HTMLElement;
  /** A serial cable connected (in the connections popup). */
  adopt(link: DbusLink, portName: string): void;
  /** Its connection ended. */
  dropped(): void;
}

export function createSerialView(opts: {
  say: (text: string) => void;
  log: (text: string, err: boolean) => void;
  /** Opens the connections popup and connects what's picked. */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  pickFiles: () => Promise<string[]>;
  readFile: (path: string) => Promise<Uint8Array>;
}): SerialView {
  let link: DbusLink | null = null;
  let portName = "";
  let busy = false;

  const connect = el("button", { type: "button", className: "primary" }, "Connect…");
  const status = el("p", { className: "serial-status" });
  const send = el("button", { type: "button" }, "Send files…");
  const drop = el("div", { className: "serial-drop" }, el("strong", {}, "Drop TI files here"), el("span", {}, "or drag them from the Explorer, to send them to the calculator"));
  const sent = el("ol", { className: "serial-sent" });
  const intro = el("p", { className: "serial-intro" });
  const root = el("div", { className: "serial-view" },
    el("h1", {}, "Serial cable"),
    intro,
    el("div", { className: "serial-row" }, connect),
    status,
    el("div", { className: "serial-send" }, send, drop),
    el("h2", {}, "Sent"),
    sent,
    el("ul", { className: "serial-notes hint" },
      el("li", {}, "The TI-84 Plus, 84 Plus SE, 83 Plus and 83 Plus SE (through their I/O port), the TI-83 and the TI-73 take files at the home screen."),
      el("li", {}, "On a TI-82, start Link > Receive on it before sending."),
      el("li", {}, "The TI-84 Plus CE has only USB: it's in the same connections list, as a USB calculator."),
      el("li", {}, "Programs, lists, pictures, groups and other variables go over the cable; Flash apps (.8xk) and OS files go over USB.")));

  function render() {
    const support = serialSupport();
    intro.textContent = support ?? "Plug TI's grey TI-Graph Link (or a USB-to-serial adapter with one) into your computer and the calculator's link port, and connect: the list shows every connection, with the calculator to pick for a serial port.";
    connect.textContent = link ? "Disconnect" : busy ? "Connecting…" : "Connect…";
    connect.className = link ? "" : "primary";
    connect.disabled = busy || !!support;
    status.textContent = link
      ? `Connected to the ${link.model} on ${portName}.${link.model === "TI-82" ? " Start Link > Receive on it before each send." : ""} Run and Send in the calculator panel use it too.`
      : "Not connected.";
    status.classList.toggle("on", !!link);
    send.disabled = !link || busy;
    drop.classList.toggle("off", !link);
    root.classList.toggle("connected", !!link);
  }

  function noteSent(name: string, ok: boolean, detail: string) {
    const row = el("li", { className: ok ? "ok" : "err" },
      el("span", { className: "name" }, name), el("span", { className: "what" }, detail),
      el("time", {}, new Date().toLocaleTimeString()));
    sent.prepend(row);
    while (sent.children.length > 50) sent.lastElementChild!.remove();
  }

  async function doConnect() {
    busy = true;
    render();
    try {
      if (link) { await opts.disconnect(); opts.say("Disconnected the serial cable."); }
      else await opts.connect();
    } finally {
      busy = false;
      render();
    }
  }

  async function sendAll(files: TiFile[]) {
    if (!link) { opts.say("Connect the calculator first."); return; }
    if (busy) { opts.say("Wait for the files being sent."); return; }
    busy = true;
    render();
    try {
      const all = (await Promise.all(files.map(f => (BUNDLE.test(f.name) ? unbundle(f) : [f])))).flat();
      for (const file of all) {
        const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
        if (!SEND_TYPES.includes(ext)) { noteSent(file.name, false, "Not a TI file a calculator can receive."); continue; }
        opts.say(`Sending ${file.name} to the ${link.model}…`);
        try {
          await link.sendFile(file.name, file.bytes);
          noteSent(file.name, true, `Sent to the ${link.model}.`);
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          noteSent(file.name, false, why);
          opts.log(`${file.name}: ${why}`, true);
        }
      }
      opts.say(`Done sending to the ${link.model}.`);
    } finally {
      busy = false;
      render();
    }
  }

  connect.addEventListener("click", () => void doConnect());
  send.addEventListener("click", async () => {
    const paths = await opts.pickFiles();
    if (!paths.length) return;
    const files = await Promise.all(paths.map(async p => ({ name: p.split(/[\\/]/).pop()!, bytes: await opts.readFile(p) })));
    await sendAll(files);
  });
  // Drops: files from outside, or paths dragged from the Explorer. Not the editor's "drop to open".
  root.addEventListener("dragover", e => {
    const types = e.dataTransfer?.types ?? [];
    if (!types.includes("Files") && !types.includes(TREE_DRAG)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = "copy";
    drop.classList.add("over");
  });
  root.addEventListener("dragleave", e => { if (!root.contains(e.relatedTarget as Node | null)) drop.classList.remove("over"); });
  root.addEventListener("drop", async e => {
    e.preventDefault();
    e.stopPropagation();
    drop.classList.remove("over");
    const tree = e.dataTransfer?.getData(TREE_DRAG);
    const files = tree
      ? await Promise.all(tree.split("\n").filter(Boolean).map(async p => ({ name: p.split(/[\\/]/).pop()!, bytes: await opts.readFile(p) })))
      : await Promise.all([...(e.dataTransfer?.files ?? [])].map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    if (files.length) await sendAll(files);
  });
  render();

  return {
    el: root,
    adopt(next, name) {
      link = next;
      portName = name;
      render();
    },
    dropped() {
      link = null;
      render();
    },
  };
}
