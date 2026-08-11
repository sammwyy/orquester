import type { ThemeMode } from "../types";

/**
 * Colour schemes offered in settings. Each id matches a `[data-scheme="…"]`
 * block in globals.css; "mono" is the base scheme defined by the mode blocks,
 * so it needs no block of its own. Adding a scheme is an entry here plus that
 * block — no component changes.
 */
export const COLOR_SCHEMES: { id: string; label: string }[] = [
  { id: "mono", label: "Monochrome" },
  { id: "warm", label: "Warm" },
  { id: "slate", label: "Slate" },
  { id: "rose", label: "Rose" },
  { id: "green", label: "Matcha" },
  { id: "yellow", label: "Dune" },
  { id: "amethyst", label: "Amethyst" }
];

export const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "dynamic", label: "Dynamic" }
];

/** Hours the "dynamic" mode considers night. */
const DARK_FROM = 19;
const DARK_UNTIL = 7;

const DARK_QUERY = "(prefers-color-scheme: dark)";

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

/** Collapse the four settable modes into the two the CSS actually knows. */
export function resolveMode(mode: ThemeMode, now = new Date()): "light" | "dark" {
  if (mode === "light" || mode === "dark") {
    return mode;
  }
  if (mode === "dynamic") {
    const hour = now.getHours();
    return hour >= DARK_FROM || hour < DARK_UNTIL ? "dark" : "light";
  }
  return prefersDark() ? "dark" : "light";
}

/** Paint the resolved theme onto the document root. */
export function applyTheme(scheme: string, mode: "light" | "dark"): void {
  if (typeof document === "undefined") {
    return;
  }
  // Two attributes are the whole switch: the stylesheet does the rest
  // (including `color-scheme` for native widgets).
  const root = document.documentElement;
  root.dataset.scheme = scheme;
  root.dataset.mode = mode;
}

/** Subscribe to whatever can change the resolved mode for the given setting. */
export function watchMode(mode: ThemeMode, onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  if (mode === "system") {
    const query = window.matchMedia(DARK_QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }
  if (mode === "dynamic") {
    const timer = window.setInterval(onChange, 60_000);
    return () => window.clearInterval(timer);
  }
  return () => undefined;
}
