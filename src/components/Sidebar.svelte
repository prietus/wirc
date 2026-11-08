<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { Buffer, Network } from "../lib/state.svelte";

  let { onSettings, onAddNetwork, onEditNetwork }: {
    onSettings: () => void;
    onAddNetwork: () => void;
    onEditNetwork: (n: Network) => void;
  } = $props();

  let collapsed = $state<Record<string, boolean>>({});
  let brokenIcons = $state<Record<string, boolean>>({});

  function stateColor(n: Network) {
    const bouncerState = n.attrs["state"];
    if (n.state !== "registered") return "var(--fg-faint)";
    if (bouncerState === "disconnected") return "var(--err)";
    if (bouncerState === "connecting") return "var(--warn)";
    return "var(--ok)";
  }

  function stateTitle(n: Network) {
    if (n.state !== "registered") return t("side.sojuConn", { state: n.state });
    const s = n.attrs["state"];
    return s ? t("side.netState", { state: s }) + (n.attrs["error"] ? " — " + n.attrs["error"] : "") : t("side.connected");
  }

  function label(b: Buffer) {
    return b.type === "server" ? b.network.displayName : b.name;
  }
</script>

<nav class="sidebar">
  <div class="scroll">
    {#each app.orderedNetworks() as net (net.id)}
      <section class:bouncer={net.isBouncer}>
        <div class="net-row" class:active={app.active === net.server}>
          <button class="toggle" onclick={() => (collapsed[net.id] = !collapsed[net.id])} aria-label={t("side.collapse")}>
            {collapsed[net.id] ? "▸" : "▾"}
          </button>
          <button class="net" onclick={() => app.setActive(net.server)} title={stateTitle(net)}>
            {#if net.icon && !brokenIcons[net.icon]}
              <span class="net-icon">
                <img src={net.icon} alt="" referrerpolicy="no-referrer" onerror={() => (brokenIcons[net.icon!] = true)} />
                <span class="dot badge-dot" style:background={stateColor(net)}></span>
              </span>
            {:else}
              <span class="dot" style:background={stateColor(net)}></span>
            {/if}
            <span class="name">{label(net.server)}</span>
            {#if net.server.highlights}<span class="badge hl">{net.server.highlights}</span>{/if}
          </button>
          {#if !net.isBouncer && app.bouncerMode}
            <button class="icon-btn edit" title={t("side.editNetwork")} onclick={() => onEditNetwork(net)}>⚙</button>
          {/if}
        </div>
        {#if !collapsed[net.id]}
          {#each net.sortedBuffers() as buf (buf.key)}
            <button
              class="buf"
              class:active={app.active === buf}
              class:unread={buf.unread > 0}
              class:parted={buf.type === "channel" && !buf.joined}
              class:muted={buf.meta.muted}
              onclick={() => app.setActive(buf)}
            >
              <span class="name">{buf.type === "query" ? "@ " : ""}{buf.name}</span>
              {#if buf.meta.pinned}<span class="pin" aria-hidden="true">📌</span>{/if}
              {#if buf.highlights}<span class="badge hl">{buf.highlights}</span>
              {:else if buf.unread && !buf.meta.muted}<span class="badge">{buf.unread > 999 ? "999+" : buf.unread}</span>{/if}
            </button>
          {/each}
        {/if}
      </section>
    {/each}
  </div>
  <div class="footer">
    {#if app.bouncerMode}
      <button class="icon-btn" title={t("side.addNetwork")} onclick={onAddNetwork}>{t("side.addNetworkShort")}</button>
    {/if}
    <span class="spacer"></span>
    <button class="icon-btn" title={t("side.settings")} onclick={onSettings}>⚙</button>
    <button class="icon-btn" title={t("side.logout")} onclick={() => confirm(t("side.confirmLogout")) && app.logout()}>⎋</button>
  </div>
</nav>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    background: var(--bg-2);
    border-right: 1px solid var(--border);
    flex: 1;
    min-height: 0;
    min-width: 0;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 4px;
  }
  section {
    margin-bottom: 10px;
  }
  section.bouncer {
    opacity: 0.8;
  }
  .net-row {
    display: flex;
    align-items: center;
    border-radius: var(--radius);
  }
  .net-row.active,
  .buf.active {
    background: var(--bg-3);
  }
  .toggle {
    background: none;
    border: none;
    color: var(--fg-faint);
    width: 18px;
    padding: 0;
    font-size: 0.75em;
  }
  .net,
  .buf {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    text-align: left;
    padding: 4px 8px;
    border-radius: var(--radius);
    min-width: 0;
  }
  .net {
    font-weight: 600;
    padding-left: 2px;
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-dim);
  }
  .buf {
    padding-left: 22px;
    color: var(--fg-dim);
  }
  .net:hover,
  .buf:hover {
    background: var(--bg-hover);
  }
  .buf.unread {
    color: var(--fg);
    font-weight: 600;
  }
  .buf.muted {
    opacity: 0.55;
    font-weight: normal;
  }
  .pin {
    font-size: 0.7em;
    opacity: 0.7;
  }
  .buf.parted .name {
    font-style: italic;
    opacity: 0.6;
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .net-icon {
    position: relative;
    width: 18px;
    height: 18px;
    flex: none;
  }
  .net-icon img {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: cover;
    display: block;
  }
  .badge-dot {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 7px;
    height: 7px;
    box-shadow: 0 0 0 2px var(--bg-2);
  }
  .badge {
    font-size: 0.75em;
    background: var(--bg-hover);
    color: var(--fg);
    border-radius: 10px;
    padding: 0 7px;
    font-weight: 600;
  }
  .badge.hl {
    background: var(--hl);
    color: #fff;
  }
  .edit {
    opacity: 0;
  }
  .net-row:hover .edit {
    opacity: 1;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px;
    border-top: 1px solid var(--border);
  }
  .spacer {
    flex: 1;
  }
</style>
