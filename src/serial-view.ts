// The Serial tab: a real calculator on a serial cable (TI's grey TI-Graph Link, or a USB-to-serial
// adapter with one), through Web Serial (serial.ts) and TIde's own link protocol (dbus.ts). It
// connects, sends files dropped or picked here, and lists what went. While it's connected, the
// calculator panel's "Real calculator (serial cable)" uses the same connection for Run and Send.
import { DBUS_MODELS, DbusLink, type DbusModel } from "./dbus";
import { openPort, serialSupport } from "./serial";
import { SEND_TYPES, TREE_DRAG, unbundle, type TiFile } from "./calc";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

const PREF = "tide-pref-serial";
const BUNDLE = /\.b8[34]$/i;

export interface SerialView {
  el: HTMLElement;
  /** tide.json's "link": the calculator, and the port to start the chooser on. */
  setProjectLink(link: { port?: string; model?: string } | undefined): void;
  /** Called when the calculator panel stops using the connection (another calculator was picked). */
  dropped(): void;
}

export function createSerialView(opts: {
  say: (text: string) => void;
  log: (text: string, err: boolean) => void;
  /** Hands the connection to the calculator panel, or takes it back (null). */
  attach: (link: DbusLink | null, portName: string) => void;
  pickFiles: () => Promise<string[]>;
  readFile: (path: string) => Promise<Uint8Array>;
}): SerialView {
  let model: DbusModel = "TI-84 Plus";
  let port = "";
  try { ({ model = model, port = port } = JSON.parse(localStorage.getItem(PREF) ?? "{}")); } catch { /* storage unavailable or bad JSON */ }
  let project: { port?: string; model?: DbusModel } = {};
  let link: DbusLink | null = null;
  let portName = "";
  let busy = false;

  const modelSelect = el("select", { ariaLabel: "Calculator" }, ...DBUS_MODELS.map(m => el("option", { value: m }, m)));
  const connect = el("button", { type: "button", className: "primary" }, "Connect…");
  const status = el("p", { className: "serial-status" });
  const send = el("button", { type: "button" }, "Send files…");
  const drop = el("div", { className: "serial-drop" }, el("strong", {}, "Drop TI files here"), el("span", {}, "or drag them from the Explorer, to send them to the calculator"));
  const sent = el("ol", { className: "serial-sent" });
  const intro = el("p", { className: "serial-intro" });
  const root = el("div", { className: "serial-view" },
    el("h1", {}, "Serial cable"),
    intro,
    el("div", { className: "serial-row" }, el("label", {}, "Calculator ", modelSelect), connect),
    status,
    el("div", { className: "serial-send" }, send, drop),
    el("h2", {}, "Sent"),
    sent,
    el("ul", { className: "serial-notes hint" },
      el("li", {}, "The TI-84 Plus, 84 Plus SE, 83 Plus and 83 Plus SE (through their I/O port), the TI-83 and the TI-73 take files at the home screen."),
      el("li", {}, "On a TI-82, start Link > Receive on it before sending."),
      el("li", {}, "The TI-84 Plus CE has only USB: use \"Real calculator (USB)\" in the calculator panel."),
      el("li", {}, "Programs, lists, pictures, groups and other variables go over the cable; Flash apps (.8xk) and OS files go over USB.")));

  function render() {
    const support = serialSupport();
    intro.textContent = support ?? "Plug TI's grey TI-Graph Link (or a USB-to-serial adapter with one) into your computer and the calculator's link port, pick the calculator, and connect.";
    modelSelect.value = project.model ?? model;
    modelSelect.disabled = !!link || busy;
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
    if (link) {
      const old = link;
      link = null;
      opts.attach(null, "");
      await old.close().catch(() => {});
      opts.say("Disconnected the serial cable.");
      render();
      return;
    }
    busy = true;
    render();
    const chosen = modelSelect.value as DbusModel;
    try {
      // The chooser needs this click; it starts on the port tide.json names, or the last one.
      const byteLink = await openPort(project.port ?? (port || undefined));
      const next = new DbusLink(byteLink, chosen, text => opts.log(text, false));
      try { await next.check(); } catch (err) { await next.close().catch(() => {}); throw err; }
      link = next;
      portName = byteLink.name;
      model = chosen;
      try { localStorage.setItem(PREF, JSON.stringify({ model, port: project.port ?? port })); } catch { /* storage unavailable */ }
      opts.attach(next, portName);
      opts.say(`Connected to the ${chosen} on ${portName}.`);
    } catch (err) {
      opts.say(err instanceof Error ? err.message : String(err));
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

  modelSelect.addEventListener("change", () => { model = modelSelect.value as DbusModel; });
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
    setProjectLink(cfg) {
      const known = DBUS_MODELS.find(m => m === cfg?.model);
      if (cfg?.model && !known) opts.say(`tide.json's link.model "${cfg.model}" isn't one TIde's serial link knows: ${DBUS_MODELS.join(", ")}.`);
      project = { port: cfg?.port, model: known };
      render();
    },
    dropped() {
      if (!link) return;
      const old = link;
      link = null;
      void old.close().catch(() => {});
      render();
    },
  };
}
