export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "wm_theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = String(window.localStorage.getItem(STORAGE_KEY) || "system");
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

export function setStoredTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  const effective = mode === "system" ? getSystemTheme() : mode;
  if (effective === "dark") html.classList.add("dark");
  else html.classList.remove("dark");
}

export function initTheme() {
  if (typeof window === "undefined") return;
  const mode = getStoredTheme();
  applyTheme(mode);

  // Keep in sync if user chose system.
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  const handler = () => {
    const current = getStoredTheme();
    if (current === "system") applyTheme("system");
  };
  mq?.addEventListener?.("change", handler);
}

export function toggleTheme() {
  const current = getStoredTheme();
  const next: ThemeMode = current === "dark" ? "light" : "dark";
  setStoredTheme(next);
  applyTheme(next);
  return next;
}
