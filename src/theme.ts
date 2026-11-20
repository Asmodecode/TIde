// Dark and light mode. The page's colors are style.css's tokens, switched by <html data-theme>; the
// editor has a theme for each (language.ts), and the terminal follows the attribute (terminal.ts).
// "system" follows the operating system's setting, and changes when it does.
import * as monaco from "monaco-editor/editor/editor.api.js";
import { onSettingsChange, settings } from "./settings";

const systemLight = matchMedia("(prefers-color-scheme: light)");

/** Whether light mode is showing. */
export const isLight = () => document.documentElement.dataset.theme === "light";

export function applyTheme() {
  const choice = settings().theme;
  const light = choice === "light" || (choice === "system" && systemLight.matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
  monaco.editor.setTheme(light ? "tide-light" : "tide");
}

/** Applies the theme now, and again when the setting or the system's mode changes. */
export function watchTheme() {
  applyTheme();
  onSettingsChange(applyTheme);
  systemLight.addEventListener("change", () => { if (settings().theme === "system") applyTheme(); });
}
