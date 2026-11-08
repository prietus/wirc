import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULTS, exportTheme, parseTheme, toHex } from "../src/lib/theme";

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector + " {");
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

describe("theme defaults", () => {
  const css = readFileSync(new URL("../src/app.css", import.meta.url), "utf8");
  it("match app.css", () => {
    const dark = block(css, ":root");
    const light = block(css, ':root[data-theme="light"]');
    for (const [k, v] of Object.entries(DEFAULTS.dark)) expect(dark[k], k).toBe(v);
    for (const [k, v] of Object.entries(DEFAULTS.light)) expect(light[k], k).toBe(v);
    for (const [k, v] of Object.entries(DEFAULTS.common)) expect(dark[k], k).toBe(v);
  });
});

describe("theme files", () => {
  it("round-trips and drops unknown keys", () => {
    const json = exportTheme({ dark: { "--accent": "#ff0000" }, light: {}, common: { "--radius": "0" } }, ".line{}");
    const back = parseTheme(json);
    expect(back.custom.dark["--accent"]).toBe("#ff0000");
    expect(back.css).toBe(".line{}");
    const evil = parseTheme(JSON.stringify({ wircTheme: 1, dark: { "--accent": "#fff", "--x": "y", onload: "z" }, css: 5 }));
    expect(evil.custom.dark).toEqual({ "--accent": "#fff" });
    expect(evil.css).toBe("");
    expect(() => parseTheme('{"foo":1}')).toThrow();
  });

  it("normalises hex colours", () => {
    expect(toHex("#ABC")).toBe("#aabbcc");
    expect(toHex("#7aa2f7")).toBe("#7aa2f7");
    expect(toHex("rgba(1,2,3,.5)")).toBeNull();
  });
});
