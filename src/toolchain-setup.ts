// "Install the toolchain?": the window TIde shows when a project's build needs a toolchain that isn't
// installed (main.ts decides when). It says what's missing and offers what can be done: download
// and install it (the CE toolchain), use one you already have, read how to install it, or not now.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

export interface ToolchainOffer {
  title: string;
  /** Why it's needed and what's missing. */
  body: string;
  /** Something else missing that TIde can't install, such as make: shown as a warning. */
  note?: string;
  /** Downloading and installing it, if TIde can: the button's label, and the work. Resolves with a line to show. */
  install?: { label: string; busy: string; run: () => Promise<string> };
  /** Using an install you have: the button's label, and picking it. Resolves false if nothing was picked. */
  use?: { label: string; run: () => Promise<boolean> };
  /** How to install it yourself. */
  guide?: { label: string; url: string };
  /** Shown with "Don't ask again", for asking when a project opens. */
  remember?: string;
  openUrl: (url: string) => void;
}

/** "installed" or "used": it's set up now. "later": not now. "never": not now, nor again for this. */
export type ToolchainAnswer = "installed" | "used" | "later" | "never";

/** Shows the window and resolves with what the user did. */
export function offerToolchain(offer: ToolchainOffer): Promise<ToolchainAnswer> {
  return new Promise((resolve) => {
    const status = el("p", { className: "toolchain-status", role: "status", hidden: true });
    const never = el("input", { type: "checkbox" });
    const later = el("button", { type: "button" }, "Not now");
    const buttons: HTMLButtonElement[] = [later];
    const busy = (on: boolean) => { for (const b of buttons) b.disabled = on; };
    const say = (text: string, kind: "" | "ok" | "err" = "") => {
      status.hidden = !text;
      status.textContent = text;
      status.className = `toolchain-status${kind ? ` ${kind}` : ""}`;
    };
    let done = false;
    const finish = (answer: ToolchainAnswer) => {
      if (done) return;
      done = true;
      dialog.close();
      dialog.remove();
      resolve(answer === "later" && never.checked ? "never" : answer);
    };

    const actions: HTMLElement[] = [];
    if (offer.guide) {
      const { url, label } = offer.guide;
      actions.push(el("a", { className: "toolchain-guide", href: url, onclick: (e: Event) => { e.preventDefault(); offer.openUrl(url); } }, label));
    }
    actions.push(el("span", { className: "spacer" }), later);
    if (offer.use) {
      const { label, run } = offer.use;
      const use = el("button", { type: "button" }, label);
      use.addEventListener("click", async () => {
        busy(true);
        try {
          if (await run()) return finish("used");
          say("");
        } catch (err) {
          say(err instanceof Error ? err.message : String(err), "err");
        } finally {
          busy(false);
        }
      });
      buttons.push(use);
      actions.push(use);
    }
    if (offer.install) {
      const { label, busy: working, run } = offer.install;
      const install = el("button", { type: "button", className: "primary" }, label);
      install.addEventListener("click", async () => {
        busy(true);
        install.textContent = working;
        say(working);
        try {
          say(await run(), "ok");
          install.textContent = "Installed";
          window.setTimeout(() => finish("installed"), 900);
        } catch (err) {
          say(`Couldn't install it: ${err instanceof Error ? err.message : err}`, "err");
          install.textContent = "Try again";
          busy(false);
        }
      });
      buttons.push(install);
      actions.push(install);
    }
    later.addEventListener("click", () => finish("later"));

    const dialog = el("dialog", { className: "update-dialog toolchain-dialog" },
      el("h2", {}, offer.title),
      el("p", { className: "hint" }, offer.body),
      ...(offer.note ? [el("p", { className: "toolchain-note" }, offer.note)] : []),
      status,
      ...(offer.remember ? [el("label", { className: "toolchain-never" }, never, offer.remember)] : []),
      el("div", { className: "actions" }, ...actions));
    // Escape is Not now, but not while it's installing.
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (!later.disabled) finish("later");
    });
    document.body.append(dialog);
    dialog.showModal();
    (buttons[buttons.length - 1] ?? later).focus();
  });
}
