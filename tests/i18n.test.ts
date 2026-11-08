import { describe, expect, it } from "vitest";
import { _dicts, t } from "../src/lib/i18n.svelte";
import { settings } from "../src/lib/settings.svelte";
import { COMMANDS, descriptionOf, usageOf } from "../src/lib/commands";

describe("i18n", () => {
  it("defaults to English", () => {
    expect(settings.language).toBe("en");
    expect(t("login.connect")).toBe("Connect");
  });

  it("es and en have the same keys, none empty", () => {
    const en = Object.keys(_dicts.en).sort();
    expect(Object.keys(_dicts.es).sort()).toEqual(en);
    for (const d of Object.values(_dicts)) for (const v of Object.values(d)) expect(v.trim()).not.toBe("");
  });

  it("placeholders match between languages", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(_dicts.en) as (keyof typeof _dicts.en)[]) {
      expect(ph(_dicts.es[k]), k).toEqual(ph(_dicts.en[k]));
    }
  });

  it("interpolates and switches language", () => {
    expect(t("st.connectedAs", { nick: "teraflops" })).toBe("Connected as teraflops");
    settings.language = "es";
    expect(t("st.connectedAs", { nick: "teraflops" })).toBe("Conectado como teraflops");
    settings.language = "en";
  });

  it("every command has usage and description", () => {
    for (const name of Object.keys(COMMANDS)) {
      expect(usageOf(name), name).toMatch(/^\//);
      expect(descriptionOf(name), name).not.toMatch(/^cmd\./);
    }
  });
});
