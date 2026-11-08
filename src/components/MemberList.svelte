<script lang="ts">
  import { nickColor } from "../irc/formatting";
  import { settings } from "../lib/settings.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { Buffer } from "../lib/state.svelte";

  let { buf, onNick }: { buf: Buffer; onNick: (nick: string) => void } = $props();

  let filter = $state("");
  const members = $derived(buf.sortedMembers());
  const shown = $derived(
    filter ? members.filter((m) => m.nick.toLowerCase().includes(filter.toLowerCase())) : members,
  );
</script>

<aside class="members">
  <div class="head">
    <span>{t("members.count", { n: members.length })}</span>
  </div>
  {#if members.length > 15}
    <input class="filter" placeholder={t("members.filter")} bind:value={filter} />
  {/if}
  <div class="list">
    {#each shown.slice(0, 1000) as m (m.nick)}
      <button
        class="member"
        class:away={m.away}
        title={[m.user && m.host ? `${m.nick}!${m.user}@${m.host}` : m.nick, m.account && t("members.account", { account: m.account }), m.away && t("buf.away")].filter(Boolean).join("\n")}
        onclick={() => onNick(m.nick)}
      >
        <span class="prefix">{m.prefix[0] ?? ""}</span>
        <span style:color={settings.nickColors ? nickColor(m.nick) : undefined}>{m.nick}</span>
      </button>
    {/each}
    {#if shown.length > 1000}
      <div class="more">{t("members.more", { n: shown.length - 1000 })}</div>
    {/if}
  </div>
</aside>

<style>
  .members {
    display: flex;
    flex-direction: column;
    background: var(--bg-2);
    border-left: 1px solid var(--border);
    flex: 1;
    min-height: 0;
    min-width: 0;
  }
  .head {
    padding: 12px 12px 6px;
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-faint);
    font-weight: 600;
  }
  .filter {
    margin: 0 8px 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px 8px;
  }
  .list {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    padding: 0 6px 8px;
  }
  .member {
    display: flex;
    width: 100%;
    gap: 2px;
    background: none;
    border: none;
    text-align: left;
    padding: 2px 6px;
    border-radius: var(--radius);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .member:hover {
    background: var(--bg-hover);
  }
  .member.away {
    opacity: 0.5;
  }
  .prefix {
    width: 1ch;
    color: var(--fg-dim);
    font-family: var(--mono);
    flex: none;
  }
  .more {
    color: var(--fg-faint);
    padding: 6px;
    font-size: 0.85em;
  }
</style>
