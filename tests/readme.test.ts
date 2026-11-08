import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULTS, parseTheme } from "../src/lib/theme";

// Keep the README's theming docs in sync with the code.
describe("README theming docs", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  it("theme file example imports", () => {
    const json = /\*\*Export\*\* produces[\s\S]*?```json\n([\s\S]*?)```/.exec(readme)![1];
    const t = parseTheme(json);
    expect(t.custom.dark["--accent"]).toBe("#bd93f9");
    expect(t.custom.common["--radius"]).toBe("4px");
  });

  it("token table lists every default", () => {
    for (const mode of ["dark", "light"] as const) {
      for (const [k, v] of Object.entries(DEFAULTS[mode])) {
        expect(readme, `${mode} ${k}`).toContain(`| \`${k}\` |`);
        expect(readme, `${mode} ${k}=${v}`).toContain(`\`${v}\``);
      }
    }
  });
});
