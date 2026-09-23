import { getSetting, setSetting } from "./db/settings";

/**
 * Light or dark, and nothing else in the app may decide it.
 *
 * The palette lives entirely in CSS variables (src/index.css); this sets
 * `data-theme` on <html> and everything follows. Components never branch on
 * the theme — if something needs to differ, it needs a token, not an `if`.
 * The one exception is the mascot kit, which is a vendored asset that paints
 * itself and has to be told (mascot/Beetle.tsx).
 *
 * "system" follows the OS and keeps following it while the app is open.
 *
 * This file is the same in elytra-desktop and elytra-mobile: change both.
 */

export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const listeners = new Set<(t: Theme) => void>();
let choice: ThemeChoice = "dark";
let applied: Theme = "dark";

function systemTheme(): Theme {
  return window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

function resolve(c: ThemeChoice): Theme {
  return c === "system" ? systemTheme() : c;
}

function apply(t: Theme) {
  applied = t;
  document.documentElement.dataset.theme = t;
  // The window chrome and the browser's own form controls read this.
  document.documentElement.style.colorScheme = t;
  for (const fn of listeners) fn(t);
}

/** The theme actually showing right now. */
export function currentTheme(): Theme {
  return applied;
}

export function themeChoice(): ThemeChoice {
  return choice;
}

export function onThemeChange(fn: (t: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reads the saved choice and applies it. Call once, as early as possible —
 *  before React renders, so the first paint is already the right colour. */
export async function startTheme(): Promise<void> {
  // Paint from the last known value immediately; the database read below is
  // async and a flash of the wrong theme is worse than a frame of the old one.
  const remembered = safeLocal();
  if (remembered) {
    choice = remembered;
    apply(resolve(remembered));
  }
  window.matchMedia?.(DARK_QUERY).addEventListener("change", () => {
    if (choice === "system") apply(systemTheme());
  });
  try {
    const stored = (await getSetting(KEY)) as ThemeChoice | null;
    const next: ThemeChoice = stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
    choice = next;
    rememberLocal(next);
    apply(resolve(next));
  } catch {
    // No database yet (first run, or the capture window): the default stands.
  }
}

export async function setThemeChoice(next: ThemeChoice): Promise<void> {
  choice = next;
  rememberLocal(next);
  apply(resolve(next));
  await setSetting(KEY, next).catch(() => {});
}

/**
 * A copy in localStorage purely so the very first paint is right. The database
 * is still the source of truth — this is a cache, and a stale or missing one
 * costs a single frame, never a wrong setting.
 */
function safeLocal(): ThemeChoice | null {
  try {
    const v = localStorage.getItem("elytra-theme");
    return v === "light" || v === "dark" || v === "system" ? v : null;
  } catch {
    return null;
  }
}

function rememberLocal(v: ThemeChoice) {
  try {
    localStorage.setItem("elytra-theme", v);
  } catch {
    // private mode, or storage blocked — the database still has it
  }
}
