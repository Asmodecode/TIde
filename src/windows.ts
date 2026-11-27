// TIde's windows (desktop app only): each one opens its own folder or workspace. A new window is
// the same page with what to open in its address: ?folder=<path>, ?workspace=<file>, or ?new for an
// empty window. The first window ("main") reopens what was open last; the others open what they're given.

/** What this window was opened with, if it was opened by another. */
export interface WindowStart {
  folder?: string;
  workspace?: string;
  /** An empty window: nothing reopens. */
  empty?: boolean;
}

export function windowStart(): WindowStart | null {
  const q = new URLSearchParams(location.search);
  if (q.has("folder")) return { folder: q.get("folder")! };
  if (q.has("workspace")) return { workspace: q.get("workspace")! };
  if (q.has("new")) return { empty: true };
  return null;
}

let count = 0;
/** Opens another TIde window with a folder, a workspace, or nothing. */
export async function openWindow(start: WindowStart = { empty: true }) {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const q = start.folder
    ? `folder=${encodeURIComponent(start.folder)}`
    : start.workspace
      ? `workspace=${encodeURIComponent(start.workspace)}`
      : "new";
  const label = `tide-${Date.now().toString(36)}-${count++}`;
  const win = new WebviewWindow(label, {
    url: `index.html?${q}`,
    title: "TIde", // the window adds its folder's name once it's open
    width: 1200,
    height: 800,
    dragDropEnabled: false,
  });
  await new Promise<void>((resolve, reject) => {
    void win.once("tauri://created", () => resolve());
    void win.once("tauri://error", (e) => reject(new Error(String(e.payload))));
  });
}

/** Names this window (or browser tab) after what it has open. */
export async function titleWindow(name: string | null, desktop: boolean, nightlyWeb: boolean) {
  const app = nightlyWeb ? "TIde Nightly" : "TIde";
  const title = name ? `${name} — ${app}` : app;
  document.title = title;
  if (!desktop) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  } catch {
    /* not in the desktop app */
  }
}
