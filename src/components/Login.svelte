<script lang="ts">
  import { app, config } from "../lib/app.svelte";
  import { LANGS, t } from "../lib/i18n.svelte";
  import { saveSettings, settings } from "../lib/settings.svelte";

  function defaultUrl(): string {
    if (config.server.url) return config.server.url;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/socket`;
  }

  let saved: { url?: string; username?: string; nick?: string; password?: string; realname?: string } = {};
  try {
    saved = JSON.parse(localStorage.getItem("wirc.login") ?? "{}");
  } catch {}

  let url = $state(saved.url ?? defaultUrl());
  let username = $state(saved.username ?? "");
  let nick = $state(saved.nick ?? "");
  let password = $state(saved.password ?? "");
  let realname = $state(saved.realname ?? "");
  let remember = $state(!!saved.password);
  let showAdvanced = $state(!!saved.url && saved.url !== defaultUrl());

  const fixedServer = !!config.server.url;

  function submit(e: Event) {
    e.preventDefault();
    const info = { url, username, nick: nick || username, password, realname: realname || undefined };
    try {
      const toSave: Record<string, string | undefined> = { ...info };
      if (!remember) delete toSave.password;
      localStorage.setItem("wirc.login", JSON.stringify(toSave));
    } catch {}
    app.connect(info);
  }

  // Auto-connect with saved credentials.
  if (saved.password && saved.username && app.status === "idle") {
    queueMicrotask(() => app.connect({ url, username, nick: nick || username, password, realname: realname || undefined }));
  }
</script>

<div class="wrap">
  <form class="card" onsubmit={submit}>
    <div class="brand">
      <span class="logo">#w</span>
      <div>
        <h1>wirc</h1>
        <p>{t("login.subtitle")}</p>
      </div>
    </div>

    <div class="field">
      <label for="username">{t("login.username")}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="username" bind:value={username} autocomplete="username" required autofocus />
    </div>
    <div class="field">
      <label for="password">{t("login.password")}</label>
      <input id="password" type="password" bind:value={password} autocomplete="current-password" required />
    </div>
    <div class="field">
      <label for="nick">{t("login.nick")} <span class="opt">{t("login.optional")}</span></label>
      <input id="nick" bind:value={nick} placeholder={username || "nick"} autocomplete="nickname" />
    </div>

    {#if !fixedServer}
      <button type="button" class="link" onclick={() => (showAdvanced = !showAdvanced)}>
        {showAdvanced ? "▾" : "▸"} {t("login.server")}
      </button>
      {#if showAdvanced}
        <div class="field">
          <label for="url">{t("login.url")}</label>
          <input id="url" bind:value={url} required />
          <span class="hint">{t("login.urlHint")}</span>
        </div>
        <div class="field">
          <label for="realname">{t("login.realname")}</label>
          <input id="realname" bind:value={realname} />
        </div>
      {/if}
    {/if}

    <label class="check"><input type="checkbox" bind:checked={remember} /> {t("login.remember")}</label>

    {#if app.status === "error"}
      <div class="error">{app.statusText}</div>
    {/if}

    <button class="btn primary submit" disabled={app.status === "connecting"}>
      {app.status === "connecting" ? t("login.connecting") : t("login.connect")}
    </button>

    {#if config.source}
      <a class="source" href={config.source} target="_blank" rel="noopener noreferrer">{t("about.source")}</a>
    {/if}
    <div class="langs">
      {#each LANGS as l (l.id)}
        <button
          type="button"
          class:on={settings.language === l.id}
          onclick={() => {
            settings.language = l.id;
            saveSettings();
          }}>{l.name}</button
        >
      {/each}
    </div>
  </form>
</div>

<style>
  .wrap {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    overflow: auto;
  }
  .card {
    width: 100%;
    max-width: 360px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 28px;
  }
  .brand {
    display: flex;
    gap: 14px;
    align-items: center;
    margin-bottom: 24px;
  }
  .logo {
    font-family: var(--mono);
    font-weight: 700;
    font-size: 22px;
    color: var(--accent);
    background: var(--bg);
    border-radius: 10px;
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
  }
  h1 {
    margin: 0;
    font-size: 1.3rem;
  }
  p {
    margin: 0;
    color: var(--fg-dim);
    font-size: 0.9em;
  }
  .opt {
    color: var(--fg-faint);
  }
  .link {
    background: none;
    border: none;
    color: var(--fg-dim);
    padding: 0;
    margin-bottom: 12px;
  }
  .submit {
    width: 100%;
    margin-top: 8px;
    padding: 10px;
  }
  .source {
    display: block;
    text-align: center;
    margin-top: 14px;
    font-size: 0.8em;
    color: var(--fg-faint);
  }
  .langs {
    display: flex;
    justify-content: center;
    gap: 4px;
    margin-top: 16px;
  }
  .langs button {
    background: none;
    border: none;
    color: var(--fg-faint);
    font-size: 0.85em;
    padding: 2px 8px;
    border-radius: var(--radius);
  }
  .langs button.on {
    color: var(--fg);
    background: var(--bg-3);
  }
  .error {
    color: var(--err);
    background: var(--hl-bg);
    border-radius: var(--radius);
    padding: 8px 10px;
    font-size: 0.9em;
    margin-bottom: 8px;
  }
</style>
