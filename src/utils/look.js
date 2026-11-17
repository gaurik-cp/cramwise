// Appearance: theme (dark / light / auto) and accent colour.
// Saved in your plan (so it follows your account) AND on this device
// (so the sign-in screen already looks right before your plan loads).
import { getSetting, setSetting } from "./alerts.js";

export const THEMES = ["auto", "dark", "light"];
export const ACCENTS = [
  { id: "lime", label: "Lime", swatch: "#b8ff3c" },
  { id: "cyan", label: "Cyan", swatch: "#47e0ff" },
  { id: "pink", label: "Pink", swatch: "#ff6bd6" },
  { id: "orange", label: "Orange", swatch: "#ff9a3c" },
];

const prefersLight = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches;

export function savedLook() {
  return getSetting("cramwise-look", { theme: "dark", accent: "lime" });
}

// Puts data-theme / data-accent on <html>, which switches the CSS variables
export function applyLook({ theme = "dark", accent = "lime" } = {}) {
  const real = theme === "auto" ? (prefersLight() ? "light" : "dark") : theme;
  document.documentElement.dataset.theme = real;
  document.documentElement.dataset.accent = ACCENTS.some((a) => a.id === accent) ? accent : "lime";
  setSetting("cramwise-look", { theme, accent });
  // Phone status bar colour
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", real === "light" ? "#f3f1fb" : "#110f1e");
}

// Re-apply when the device switches between light and dark (for "auto")
export function watchSystemTheme(getLook) {
  const mq = window.matchMedia?.("(prefers-color-scheme: light)");
  if (!mq) return () => {};
  const onChange = () => getLook().theme === "auto" && applyLook(getLook());
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}
