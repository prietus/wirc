<script lang="ts">
  import { toast } from "../lib/app.svelte";
  import { resetSettings, saveSettings, settings } from "../lib/settings.svelte";
  import Modal from "./Modal.svelte";
  import { LANGS, t } from "../lib/i18n.svelte";
  import { config } from "../lib/app.svelte";

  let { onClose, onCustomize }: { onClose: () => void; onCustomize?: () => void } = $props();

  let highlights = $state(settings.highlightWords.join("\n"));
  let ignored = $state(settings.ignored.join("\n"));

  $effect(() => {
    // Persist any change made through bindings.
    JSON.stringify(settings);
    saveSettings();
  });

  function commitLists() {
    settings.highlightWords = highlights.split("\n").map((s) => s.trim()).filter(Boolean);
    settings.ignored = ignored.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  async function toggleNotifications() {
    if (!settings.notifications) return;
    if (typeof Notification === "undefined") {
      toast(t("err.notifUnsupported"), "error");
      settings.notifications = false;
      return;
    }
    const p = await Notification.requestPermission();
    if (p !== "granted") {
      settings.notifications = false;
      toast(t("err.notifDenied"), "error");
    }
  }
</script>

<Modal title={t("set.title")} {onClose} wide>
  <div class="grid">
    <section>
      <h3>{t("set.appearance")}</h3>
      <div class="field">
        <label for="lang">{t("set.language")}</label>
        <select id="lang" bind:value={settings.language}>
          {#each LANGS as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="theme">{t("set.theme")}</label>
        <select id="theme" bind:value={settings.theme}>
          <option value="system">{t("set.themeSystem")}</option>
          <option value="dark">{t("set.themeDark")}</option>
          <option value="light">{t("set.themeLight")}</option>
        </select>
      </div>
      {#if onCustomize}
        <button class="btn customize" onclick={onCustomize}>🎨 {t("theme.customize")}</button>
      {/if}
      <div class="field">
        <label for="fs">{t("set.fontSize", { n: settings.fontSize })}</label>
        <input id="fs" type="range" min="11" max="20" bind:value={settings.fontSize} />
      </div>
      <label class="check"><input type="checkbox" bind:checked={settings.compact} /> {t("set.compact")}</label>
      <label class="check"><input type="checkbox" bind:checked={settings.nickColors} /> {t("set.nickColors")}</label>
      <label class="check"><input type="checkbox" bind:checked={settings.showSeconds} /> {t("set.showSeconds")}</label>
      <label class="check"><input type="checkbox" bind:checked={settings.use12h} /> {t("set.use12h")}</label>
      <div class="field">
        <label for="jp">{t("set.joinPart")}</label>
        <select id="jp" bind:value={settings.joinPartMode}>
          <option value="show">{t("set.jpShow")}</option>
          <option value="smart">{t("set.jpSmart")}</option>
          <option value="hide">{t("set.jpHide")}</option>
        </select>
        <span class="hint">{t("set.jpHint")}</span>
      </div>
      <label class="check"><input type="checkbox" bind:checked={settings.inlineMedia} /> {t("set.inlineMedia")}</label>
      <span class="hint media-hint">{t("set.inlineMediaHint")}</span>
      <div class="field">
        <label for="msize">{t("set.mediaSize")}</label>
        <select id="msize" bind:value={settings.mediaSize} disabled={!settings.inlineMedia}>
          <option value="small">{t("set.mediaSmall")}</option>
          <option value="medium">{t("set.mediaMedium")}</option>
          <option value="large">{t("set.mediaLarge")}</option>
        </select>
      </div>
    </section>

    <section>
      <h3>{t("set.notifications")}</h3>
      <label class="check">
        <input type="checkbox" bind:checked={settings.notifications} onchange={toggleNotifications} /> {t("set.desktopNotif")}
      </label>
      <label class="check"><input type="checkbox" bind:checked={settings.notifyAllQueries} /> {t("set.notifyQueries")}</label>
      <label class="check"><input type="checkbox" bind:checked={settings.sendTyping} /> {t("set.sendTyping")}</label>
      <label class="check"><input type="checkbox" bind:checked={settings.showTyping} /> {t("set.showTyping")}</label>

      <div class="field">
        <label for="hl">{t("set.highlights")}</label>
        <textarea id="hl" rows="4" bind:value={highlights} onchange={commitLists}></textarea>
        <span class="hint">{t("set.highlightsHint")}</span>
      </div>
      <div class="field">
        <label for="ign">{t("set.ignored")}</label>
        <textarea id="ign" rows="3" bind:value={ignored} onchange={commitLists}></textarea>
        <span class="hint">{t("set.ignoredHint")}</span>
      </div>
    </section>
  </div>

  <h3>{t("set.shortcuts")}</h3>
  <table class="keys">
    <tbody>
      <tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>{t("set.kJump")}</td></tr>
      <tr><td><kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>9</kbd></td><td>{t("set.kGoto")}</td></tr>
      <tr><td><kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd></td><td>{t("set.kPrevNext")}</td></tr>
      <tr><td><kbd>Alt</kbd>+<kbd>A</kbd></td><td>{t("set.kActivity")}</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>F</kbd></td><td>{t("set.kSearch")}</td></tr>
      <tr><td><kbd>Tab</kbd></td><td>{t("set.kComplete")}</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>B</kbd>/<kbd>I</kbd>/<kbd>U</kbd></td><td>{t("set.kFormat")}</td></tr>
      <tr><td><kbd>Shift</kbd>+<kbd>Enter</kbd></td><td>{t("set.kNewline")}</td></tr>
    </tbody>
  </table>

  <p class="about">
    wirc · <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">AGPL-3.0</a>
    {#if config.source}· <a href={config.source} target="_blank" rel="noopener noreferrer">{t("about.source")}</a>{/if}
  </p>

  {#snippet footer()}
    <button class="btn danger" onclick={() => confirm(t("set.confirmReset")) && resetSettings()}>{t("set.reset")}</button>
    <button class="btn primary" onclick={() => { commitLists(); onClose(); }}>{t("set.done")}</button>
  {/snippet}
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 24px;
  }
  h3 {
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-faint);
    margin: 0 0 12px;
  }
  .media-hint {
    display: block;
    font-size: 0.8em;
    color: var(--fg-faint);
    margin: -4px 0 8px 24px;
  }
  .customize {
    width: 100%;
    margin-bottom: 12px;
  }
  .about {
    margin: 16px 0 0;
    font-size: 0.8em;
    color: var(--fg-faint);
  }
  .keys {
    font-size: 0.9em;
    border-spacing: 0 4px;
  }
  .keys td:first-child {
    padding-right: 16px;
    white-space: nowrap;
  }
</style>
