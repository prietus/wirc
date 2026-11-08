// Theme tokens (CSS custom properties) and user overrides.
// Defaults must match src/app.css (checked by tests/theme.test.ts).

export type Mode = "dark" | "light";

export interface ThemeCustom {
  dark: Record<string, string>;
  light: Record<string, string>;
  /** Mode-independent tokens (fonts, radius). */
  common: Record<string, string>;
}

export const COLOR_TOKENS = [
  "--bg",
  "--bg-2",
  "--bg-3",
  "--bg-hover",
  "--border",
  "--fg",
  "--fg-dim",
  "--fg-faint",
  "--accent",
  "--accent-fg",
  "--hl",
  "--hl-bg",
  "--ok",
  "--warn",
  "--err",
  "--nick-lightness",
] as const;

export const COMMON_TOKENS = ["--font", "--mono", "--radius"] as const;

export const DEFAULTS: Record<Mode, Record<string, string>> & { common: Record<string, string> } = {
  dark: {
    "--bg": "#16181d",
    "--bg-2": "#1c1f26",
    "--bg-3": "#242833",
    "--bg-hover": "#2a2f3b",
    "--border": "#2c313c",
    "--fg": "#d5d9e2",
    "--fg-dim": "#8a91a0",
    "--fg-faint": "#5d6472",
    "--accent": "#7aa2f7",
    "--accent-fg": "#0f1115",
    "--hl-bg": "rgba(247, 118, 142, 0.12)",
    "--hl": "#f7768e",
    "--ok": "#9ece6a",
    "--warn": "#e0af68",
    "--err": "#f7768e",
    "--nick-lightness": "68%",
  },
  light: {
    "--bg": "#fafafa",
    "--bg-2": "#f0f1f4",
    "--bg-3": "#e5e7ec",
    "--bg-hover": "#e1e4ea",
    "--border": "#d9dce3",
    "--fg": "#1f2329",
    "--fg-dim": "#5c6370",
    "--fg-faint": "#8b919c",
    "--accent": "#3466d6",
    "--accent-fg": "#ffffff",
    "--hl-bg": "rgba(214, 51, 82, 0.09)",
    "--hl": "#c4304d",
    "--ok": "#3f8a1c",
    "--warn": "#a86b00",
    "--err": "#c4304d",
    "--nick-lightness": "40%",
  },
  common: {
    "--radius": "6px",
    "--font": 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    "--mono": 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
  },
};

export function emptyCustom(): ThemeCustom {
  return { dark: {}, light: {}, common: {} };
}

/** Inline-style overrides currently applied to <html>, so they can be removed. */
let applied: string[] = [];

/** Apply overrides for the active mode on <html> and inject the custom stylesheet. */
export function applyTheme(root: HTMLElement, mode: Mode, custom: ThemeCustom, css: string) {
  for (const k of applied) root.style.removeProperty(k);
  applied = [];
  const vars = { ...custom.common, ...custom[mode] };
  for (const [k, v] of Object.entries(vars)) {
    if (!k.startsWith("--") || !v.trim()) continue;
    root.style.setProperty(k, v);
    applied.push(k);
  }
  let style = document.getElementById("wirc-custom-css") as HTMLStyleElement | null;
  if (!css.trim()) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = "wirc-custom-css";
    document.head.appendChild(style);
  }
  style.textContent = css;
}

// --- import / export --------------------------------------------------------

export interface ThemeFile {
  wircTheme: 1;
  dark: Record<string, string>;
  light: Record<string, string>;
  common: Record<string, string>;
  css: string;
}

export function exportTheme(custom: ThemeCustom, css: string): string {
  const f: ThemeFile = { wircTheme: 1, ...custom, css };
  return JSON.stringify(f, null, 2);
}

/** Parse a theme file, keeping only known token names and string values. */
export function parseTheme(json: string): { custom: ThemeCustom; css: string } {
  const raw = JSON.parse(json);
  if (!raw || raw.wircTheme !== 1) throw new Error("not a wirc theme");
  const pick = (o: unknown, allowed: readonly string[]) => {
    const out: Record<string, string> = {};
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) if (allowed.includes(k) && typeof v === "string") out[k] = v;
    }
    return out;
  };
  return {
    custom: {
      dark: pick(raw.dark, COLOR_TOKENS),
      light: pick(raw.light, COLOR_TOKENS),
      common: pick(raw.common, COMMON_TOKENS),
    },
    css: typeof raw.css === "string" ? raw.css : "",
  };
}

/** #rgb/#rrggbb → #rrggbb, otherwise null (for <input type="color">). */
export function toHex(v: string): string | null {
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ("#" + [...s.slice(1)].map((c) => c + c).join("")).toLowerCase();
  return null;
}
