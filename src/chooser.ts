// The desktop app's device chooser: the window a browser shows for WebUSB's requestDevice() and
// Web Serial's requestPort(), which the app's web view doesn't have. usb-shim.ts and
// serial-shim.ts open it, so the page asks for a device the same way in both.

export interface ChoiceItem {
  id: string;
  label: string;
  /** A second line: what it is, its IDs. */
  detail?: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

/**
 * Asks which device to use. `list` is called at once and again on Refresh, so a device plugged in
 * while the window is open shows up. Resolves with the chosen item's id, or null if cancelled.
 */
export function chooseDevice(opts: {
  title: string;
  /** Says what to plug in, under the title. */
  hint: string;
  empty: string;
  list: () => Promise<ChoiceItem[]>;
  /** An item to pick to begin with, such as the port tide.json names. */
  preselect?: string;
}): Promise<string | null> {
  return new Promise(resolve => {
    const items = el("div", { className: "chooser-list", role: "listbox", tabIndex: 0, ariaLabel: opts.title });
    const connect = el("button", { type: "button", className: "primary", disabled: true }, "Connect");
    const cancel = el("button", { type: "button" }, "Cancel");
    const refresh = el("button", { type: "button", className: "chooser-refresh", title: "Look for devices again" }, "Refresh");
    const dialog = el("dialog", { className: "update-dialog chooser" },
      el("h2", {}, opts.title),
      el("p", { className: "hint" }, opts.hint),
      items,
      el("div", { className: "actions" }, refresh, el("span", { className: "spacer" }), cancel, connect));
    let chosen: string | null = opts.preselect ?? null;
    let done = false;

    const finish = (id: string | null) => {
      if (done) return;
      done = true;
      window.clearInterval(poll);
      dialog.close();
      dialog.remove();
      resolve(id);
    };
    const select = (id: string) => {
      chosen = id;
      for (const row of items.querySelectorAll<HTMLElement>("[data-id]")) row.setAttribute("aria-selected", String(row.dataset.id === id));
      connect.disabled = false;
    };
    async function load() {
      let found: ChoiceItem[];
      try { found = await opts.list(); } catch (err) {
        items.replaceChildren(el("p", { className: "chooser-empty" }, `Couldn't look for devices: ${err instanceof Error ? err.message : err}`));
        return;
      }
      if (done) return;
      if (!found.length) {
        items.replaceChildren(el("p", { className: "chooser-empty" }, opts.empty));
        connect.disabled = true;
        return;
      }
      items.replaceChildren(...found.map(item => {
        const row = el("div", { className: "chooser-item", role: "option", tabIndex: -1 },
          el("strong", {}, item.label), ...(item.detail ? [el("span", {}, item.detail)] : []));
        row.dataset.id = item.id;
        row.addEventListener("click", () => select(item.id));
        row.addEventListener("dblclick", () => finish(item.id));
        return row;
      }));
      // Keep the choice if it's still there; otherwise the first one.
      select(found.some(i => i.id === chosen) ? chosen! : found[0].id);
    }

    items.addEventListener("keydown", e => {
      const rows = [...items.querySelectorAll<HTMLElement>("[data-id]")];
      const at = rows.findIndex(r => r.dataset.id === chosen);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) { select(next.dataset.id!); next.scrollIntoView({ block: "nearest" }); }
      } else if (e.key === "Enter" && chosen) { e.preventDefault(); finish(chosen); }
    });
    connect.addEventListener("click", () => finish(chosen));
    cancel.addEventListener("click", () => finish(null));
    refresh.addEventListener("click", () => void load());
    dialog.addEventListener("cancel", e => { e.preventDefault(); finish(null); }); // Escape
    // Devices come and go: look again every couple of seconds while it's open.
    const poll = window.setInterval(() => void load(), 2000);

    document.body.append(dialog);
    dialog.showModal();
    items.focus();
    void load();
  });
}
