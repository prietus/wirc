<script lang="ts">
  import { toast } from "../lib/app.svelte";
  import { t, type Key } from "../lib/i18n.svelte";
  import { saveSettings, settings } from "../lib/settings.svelte";
  import {
    COLOR_TOKENS,
    COMMON_TOKENS,
    DEFAULTS,
    emptyCustom,
    exportTheme,
    parseTheme,
    toHex,
    type Mode,
  } from "../lib/theme";
  import Modal from "./Modal.svelte";

  let { onClose }: { onClose: () => void } = $props();

  let tab = $state<"colors" | "fonts" | "css">("colors");
  let importInput: HTMLInputElement | undefined = $state();

  // What you edit is what you see: the mode currently shown.
  let mode = $state<Mode>((document.documentElement.dataset.theme as Mode) ?? "dark");

  function showMode(m: Mode) {
    mode = m;
    settings.theme = m;
  }

  $effect(() => {
    JSON.stringify(settings.themeCustom);
    void settings.customCss;
    saveSettings();
  });

  function value(group: Mode | "common", tok: string): string {
    return settings.themeCustom[group][tok] ?? (group === "common" ? DEFAULTS.common[tok] : DEFAULTS[group][tok]);
  }

  function isSet(group: Mode | "common", tok: string) {
    return settings.themeCustom[group][tok] !== undefined;
  }

  function set(group: Mode | "common", tok: string, v: string) {
    settings.themeCustom[group][tok] = v;
  }

  function reset(group: Mode | "common", tok: string) {
    delete settings.themeCustom[group][tok];
  }

  function resetAll() {
    if (!confirm(t("theme.confirmResetAll"))) return;
    settings.themeCustom = emptyCustom();
    settings.customCss = "";
  }

  function doExport() {
    const blob = new Blob([exportTheme($state.snapshot(settings.themeCustom), settings.customCss)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "wirc-theme.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function doImport() {
    const file = importInput?.files?.[0];
    if (importInput) importInput.value = "";
    if (!file) return;
    try {
      const { custom, css } = parseTheme(await file.text());
      settings.themeCustom = custom;
      settings.customCss = css;
      toast(t("theme.imported"));
      // Show the imported CSS so it's not applied unseen.
      if (css.trim()) tab = "css";
    } catch {
      toast(t("theme.importFailed"), "error");
    }
  }

  const label = (tok: string) => t(`tok.${tok}` as Key);
</script>

<Modal title={t("theme.title")} {onClose} wide>
  <div class="tabs" role="tablist">
    <button role="tab" class:on={tab === "colors"} onclick={() => (tab = "colors")}>{t("theme.colors")}</button>
    <button role="tab" class:on={tab === "fonts"} onclick={() => (tab = "fonts")}>{t("theme.fonts")}</button>
    <button role="tab" class:on={tab === "css"} onclick={() => (tab = "css")}>{t("theme.css")}</button>
  </div>

  {#if tab === "colors"}
    <div class="modes">
      <span>{t("theme.editing", { mode: t(mode === "dark" ? "theme.dark" : "theme.light") })}</span>
      <div class="seg">
        <button class:on={mode === "dark"} onclick={() => showMode("dark")}>🌙 {t("set.themeDark")}</button>
        <button class:on={mode === "light"} onclick={() => showMode("light")}>☀️ {t("set.themeLight")}</button>
      </div>
    </div>
    <div class="rows">
      {#each COLOR_TOKENS as tok (tok)}
        {@const v = value(mode, tok)}
        <div class="row" class:custom={isSet(mode, tok)}>
          <label for="tok{tok}">{label(tok)}</label>
          {#if tok === "--nick-lightness"}
            <input
              id="tok{tok}"
              type="range"
              min="20"
              max="90"
              value={parseInt(v, 10)}
              oninput={(e) => set(mode, tok, e.currentTarget.value + "%")}
            />
            <span class="val">{v}</span>
          {:else}
            {@const hex = toHex(v)}
            <input
              class="swatch"
              type="color"
              value={hex ?? "#000000"}
              disabled={!hex}
              title={hex ? undefined : v}
              oninput={(e) => set(mode, tok, e.currentTarget.value)}
            />
            <input id="tok{tok}" class="text" value={v} onchange={(e) => set(mode, tok, e.currentTarget.value)} />
          {/if}
          <button
            class="icon-btn reset"
            disabled={!isSet(mode, tok)}
            title={t("theme.reset") + " (" + t("theme.default") + ")"}
            onclick={() => reset(mode, tok)}>↺</button
          >
        </div>
      {/each}
    </div>
  {:else if tab === "fonts"}
    <div class="rows">
      {#each COMMON_TOKENS as tok (tok)}
        {@const v = value("common", tok)}
        <div class="row wide" class:custom={isSet("common", tok)}>
          <label for="tok{tok}">{label(tok)}</label>
          {#if tok === "--radius"}
            <input
              id="tok{tok}"
              type="range"
              min="0"
              max="14"
              value={parseInt(v, 10)}
              oninput={(e) => set("common", tok, e.currentTarget.value + "px")}
            />
            <span class="val">{v}</span>
          {:else}
            <input
              id="tok{tok}"
              class="text"
              value={v}
              style:font-family={v}
              onchange={(e) => set("common", tok, e.currentTarget.value)}
            />
          {/if}
          <button
            class="icon-btn reset"
            disabled={!isSet("common", tok)}
            title={t("theme.reset")}
            onclick={() => reset("common", tok)}>↺</button
          >
        </div>
      {/each}
    </div>
  {:else}
    <textarea class="css" spellcheck="false" bind:value={settings.customCss} placeholder={".line[data-nick=\"bot\"] { opacity: .5 }"}
    ></textarea>
    <p class="hint">{t("theme.cssHint")}</p>
  {/if}

  {#snippet footer()}
    <input bind:this={importInput} type="file" accept="application/json,.json" hidden onchange={doImport} />
    <button class="btn" onclick={() => importInput?.click()}>{t("theme.import")}</button>
    <button class="btn" onclick={doExport}>{t("theme.export")}</button>
    <button class="btn danger" onclick={resetAll}>{t("theme.resetAll")}</button>
    <span style="flex:1"></span>
    <button class="btn primary" onclick={onClose}>{t("set.done")}</button>
  {/snippet}
</Modal>

<style>
  .tabs,
  .seg {
    display: flex;
    gap: 4px;
  }
  .tabs {
    margin-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    background: none;
    border: none;
    padding: 6px 12px;
    color: var(--fg-dim);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tabs button.on {
    color: var(--fg);
    border-bottom-color: var(--accent);
  }
  .modes {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    color: var(--fg-dim);
    font-size: 0.9em;
    flex-wrap: wrap;
  }
  .seg button {
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px 10px;
  }
  .seg button.on {
    border-color: var(--accent);
    color: var(--fg);
  }
  .rows {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 6px 20px;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 32px 150px 24px;
    align-items: center;
    gap: 6px;
  }
  .row:has(input[type="range"]) {
    grid-template-columns: 1fr 1fr 50px 24px;
  }
  .row.wide {
    grid-template-columns: 160px 1fr 24px;
    grid-column: 1 / -1;
  }
  .row.wide:has(input[type="range"]) {
    grid-template-columns: 160px 1fr 50px 24px;
  }
  .row label {
    font-size: 0.88em;
    color: var(--fg-dim);
  }
  .row.custom label {
    color: var(--fg);
    font-weight: 600;
  }
  .swatch {
    width: 32px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: none;
  }
  .swatch:disabled {
    opacity: 0.3;
  }
  .text {
    min-width: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px 8px;
    font-family: var(--mono);
    font-size: 0.82em;
  }
  .val {
    font-family: var(--mono);
    font-size: 0.8em;
    color: var(--fg-dim);
  }
  .reset:disabled {
    opacity: 0.2;
  }
  .css {
    width: 100%;
    min-height: 260px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px;
    font-family: var(--mono);
    font-size: 0.85em;
    resize: vertical;
  }
  .hint {
    font-size: 0.8em;
    color: var(--fg-faint);
    margin: 8px 0 0;
  }
</style>
