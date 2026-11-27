// TIde's own option list for every <select>. WebKitGTK (the desktop app) draws a select's list
// itself, ignoring the page's styles, so a click or Enter on any single-choice select opens this
// list instead. The select stays the real control: picking sets its value and fires input and
// change, as the native list does, so the code that reads selects doesn't know the difference.
// Focus stays on the select; arrows move, Enter or Space picks, Escape or clicking elsewhere closes,
// and typing jumps to an option starting with those letters.

let popup: HTMLElement | null = null;
let owner: HTMLSelectElement | null = null;
let rows: { el: HTMLElement; option: HTMLOptionElement }[] = [];
let activeAt = -1;
let typed = "";
let typedAt = 0;

const usable = (s: HTMLSelectElement) => !s.multiple && s.size <= 1 && !s.disabled;

function close(refocus = true) {
  popup?.remove();
  popup = null;
  owner?.removeAttribute("aria-expanded");
  owner?.removeAttribute("aria-activedescendant");
  if (refocus) owner?.focus({ preventScroll: true });
  owner = null;
  rows = [];
  activeAt = -1;
}

function setActive(at: number, scroll = true) {
  if (!rows.length) return;
  rows[activeAt]?.el.classList.remove("active");
  activeAt = Math.max(0, Math.min(rows.length - 1, at));
  const row = rows[activeAt].el;
  row.classList.add("active");
  owner?.setAttribute("aria-activedescendant", row.id);
  // By hand: scrollIntoView can scroll the page under the list too, which closes it.
  if (scroll && popup) {
    const top = row.offsetTop, bottom = top + row.offsetHeight;
    if (top < popup.scrollTop) popup.scrollTop = top - 4;
    else if (bottom > popup.scrollTop + popup.clientHeight) popup.scrollTop = bottom - popup.clientHeight + 4;
  }
}

function pick(at: number) {
  const select = owner, row = rows[at];
  close();
  if (!select || !row || row.option.selected) return;
  row.option.selected = true;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

let ids = 0;
function open(select: HTMLSelectElement) {
  close(false);
  owner = select;
  const list = document.createElement("div");
  list.className = "select-popup";
  list.setAttribute("role", "listbox");
  list.id = `select-popup-${++ids}`;
  list.addEventListener("mousedown", (e) => e.preventDefault()); // keeps focus on the select
  select.setAttribute("aria-expanded", "true");
  select.setAttribute("aria-controls", list.id);
  const addOption = (option: HTMLOptionElement, grouped: boolean) => {
    if (option.hidden) return;
    const row = document.createElement("div");
    row.className = `select-option${grouped ? " grouped" : ""}`;
    row.id = `${list.id}-${rows.length}`;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(option.selected));
    if (option.title) row.title = option.title;
    row.append(
      Object.assign(document.createElement("i"), { className: "check", textContent: option.selected ? "✓" : "", ariaHidden: "true" }),
      Object.assign(document.createElement("span"), { textContent: option.label || option.text }),
    );
    if (option.disabled) {
      row.setAttribute("aria-disabled", "true");
      list.append(row);
      return;
    }
    const at = rows.length;
    rows.push({ el: row, option });
    row.addEventListener("pointermove", () => { if (activeAt !== at) setActive(at, false); });
    row.addEventListener("click", () => pick(at));
    list.append(row);
  };
  for (const child of select.children) {
    if (child instanceof HTMLOptGroupElement) {
      const options = [...child.children].filter((o): o is HTMLOptionElement => o instanceof HTMLOptionElement && !o.hidden);
      if (!options.length) continue;
      list.append(Object.assign(document.createElement("div"), { className: "select-group", textContent: child.label, role: "presentation" }));
      for (const o of options) addOption(o, true);
    } else if (child instanceof HTMLOptionElement) addOption(child, false);
  }
  if (!rows.length) { close(false); return; }
  // Inside a modal dialog, the list has to be in the dialog too, or the dialog covers it.
  (select.closest("dialog[open]") ?? document.body).append(list);
  popup = list;
  place(select, list);
  const chosen = rows.findIndex((r) => r.option.selected);
  setActive(chosen < 0 ? 0 : chosen);
}

/** Under the select (over it when there's no room below), at least as wide, inside the window. */
function place(select: HTMLSelectElement, list: HTMLElement) {
  const box = select.getBoundingClientRect();
  list.style.minWidth = `${Math.round(box.width)}px`;
  const below = window.innerHeight - box.bottom - 8, above = box.top - 8;
  const up = below < Math.min(list.scrollHeight, 240) && above > below;
  list.style.maxHeight = `${Math.max(120, Math.min(360, up ? above : below))}px`;
  const { width, height } = list.getBoundingClientRect();
  list.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - width - 4))}px`;
  list.style.top = `${up ? Math.max(4, box.top - height - 4) : box.bottom + 4}px`;
  if (up) list.classList.add("up");
}

function typeahead(key: string) {
  const now = Date.now();
  typed = now - typedAt > 700 ? key : typed + key;
  typedAt = now;
  const text = (r: (typeof rows)[number]) => (r.option.label || r.option.text).trim().toLowerCase();
  const from = typed.length === 1 ? activeAt + 1 : activeAt;
  for (let i = 0; i < rows.length; i++) {
    const at = (from + i) % rows.length;
    if (text(rows[at]).startsWith(typed)) return setActive(at);
  }
}

document.addEventListener("mousedown", (e) => {
  const select = (e.target as Element | null)?.closest?.("select");
  if (!(select instanceof HTMLSelectElement) || e.button !== 0 || !usable(select)) return;
  e.preventDefault(); // no native list
  select.focus({ preventScroll: true });
  if (owner === select) close();
  else open(select);
}, true);

document.addEventListener("keydown", (e) => {
  if (popup && owner) {
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive(activeAt + 1),
      ArrowUp: () => setActive(activeAt - 1),
      PageDown: () => setActive(activeAt + 8),
      PageUp: () => setActive(activeAt - 8),
      Home: () => setActive(0),
      End: () => setActive(rows.length - 1),
      Enter: () => pick(activeAt),
      " ": () => (typed && Date.now() - typedAt < 700 ? typeahead(" ") : pick(activeAt)),
      Escape: () => close(),
      Tab: () => close(),
    };
    const run = keys[e.key];
    if (run) {
      if (e.key !== "Tab") e.preventDefault();
      e.stopPropagation(); // Escape closes the list, not the dialog it's in
      run();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      typeahead(e.key.toLowerCase());
    }
    return;
  }
  const select = e.target;
  if (!(select instanceof HTMLSelectElement) || !usable(select)) return;
  if (e.key === "Enter" || e.key === " " || e.key === "F4" || (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp"))) {
    e.preventDefault();
    e.stopPropagation();
    open(select);
  }
}, true);

// Close on any click elsewhere, scroll outside the list, resize, or when TIde loses focus.
window.addEventListener("pointerdown", (e) => {
  if (popup && !popup.contains(e.target as Node) && e.target !== owner) close(false);
}, true);
document.addEventListener("scroll", (e) => { if (popup && !popup.contains(e.target as Node)) close(false); }, true);
window.addEventListener("resize", () => close(false));
window.addEventListener("blur", () => close(false));
// A select that's taken away or changed while its list is open: the list goes too.
document.addEventListener("focusout", (e) => {
  if (popup && e.target === owner && !popup.contains(e.relatedTarget as Node)) queueMicrotask(() => {
    if (owner && document.activeElement !== owner) close(false);
  });
}, true);
