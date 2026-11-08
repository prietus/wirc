<script lang="ts">
  import { app, toast } from "../lib/app.svelte";
  import type { Network } from "../lib/state.svelte";
  import Modal from "./Modal.svelte";
  import { t } from "../lib/i18n.svelte";

  let { network, onClose }: { network?: Network; onClose: () => void } = $props();

  const a = network?.attrs ?? {};
  let name = $state(a.name ?? "");
  let host = $state(a.host ?? "");
  let port = $state(a.port ?? "");
  let tls = $state(a.tls !== "0");
  let nickname = $state(a.nickname ?? app.login?.nick ?? "");
  let username = $state(a.username ?? "");
  let realname = $state(a.realname ?? "");
  let pass = $state("");
  let busy = $state(false);

  async function save(e: Event) {
    e.preventDefault();
    busy = true;
    const attrs: Record<string, string> = { host, tls: tls ? "1" : "0" };
    if (name) attrs.name = name;
    if (port) attrs.port = port;
    if (nickname) attrs.nickname = nickname;
    if (username) attrs.username = username;
    if (realname) attrs.realname = realname;
    if (pass) attrs.pass = pass;
    try {
      if (network) await app.changeBouncerNetwork(network.id, attrs);
      else await app.addBouncerNetwork(attrs);
      toast(network ? t("net.updated") : t("net.added"));
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!network || !confirm(t("net.confirmDelete", { name: network.displayName }))) return;
    try {
      await app.deleteBouncerNetwork(network.id);
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
</script>

<Modal title={network ? t("net.edit", { name: network.displayName }) : t("net.add")} {onClose}>
  <form id="netform" onsubmit={save}>
    <div class="row">
      <div class="field grow">
        <label for="host">{t("net.server")}</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="host" bind:value={host} placeholder="irc.libera.chat" required autofocus={!network} />
      </div>
      <div class="field port">
        <label for="port">{t("net.port")}</label>
        <input id="port" bind:value={port} placeholder={tls ? "6697" : "6667"} inputmode="numeric" />
      </div>
    </div>
    <label class="check"><input type="checkbox" bind:checked={tls} /> TLS</label>
    <div class="field">
      <label for="name">{t("net.name")}</label>
      <input id="name" bind:value={name} placeholder="Libera" />
    </div>
    <div class="field">
      <label for="nick">{t("net.nick")}</label>
      <input id="nick" bind:value={nickname} />
    </div>
    <div class="row">
      <div class="field grow">
        <label for="user">{t("net.username")}</label>
        <input id="user" bind:value={username} />
      </div>
      <div class="field grow">
        <label for="real">{t("net.realname")}</label>
        <input id="real" bind:value={realname} />
      </div>
    </div>
    <div class="field">
      <label for="pass">{t("net.password")}</label>
      <input id="pass" type="password" bind:value={pass} placeholder={network ? t("net.unchanged") : ""} />
      <span class="hint">
        {t("net.saslHint")}
      </span>
    </div>
  </form>
  {#snippet footer()}
    {#if network}<button class="btn danger" onclick={remove}>{t("net.delete")}</button><span style="flex:1"></span>{/if}
    <button class="btn" onclick={onClose}>{t("net.cancel")}</button>
    <button class="btn primary" form="netform" disabled={busy}>{network ? t("net.save") : t("net.addButton")}</button>
  {/snippet}
</Modal>

<style>
  .row {
    display: flex;
    gap: 12px;
  }
  .grow {
    flex: 1;
  }
  .port {
    width: 90px;
  }
</style>
