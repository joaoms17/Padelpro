// Light/dark theme handling. Default: follow system, overridable and stored.
export type Theme = "light" | "dark" | "system";

const KEY = "cad.theme";

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

export function applyStoredTheme(): void {
  applyTheme(getStoredTheme());
}

export function applyTheme(theme: Theme): void {
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}
