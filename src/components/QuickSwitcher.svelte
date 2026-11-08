<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { Buffer } from "../lib/state.svelte";

  let { onClose }: { onClose: () => void } = $props();
  let q = $state("");
  let sel = $state(0);

  function score(b: Buffer, query: string): number {
    const name = (b.type === "server" ? b.network.displayName : b.name).toLowerCase();
    if (!query) return 1 + b.highlights * 100 + b.unread;
    const i = name.indexOf(query);
    if (i >= 0) return 1000 - i * 10 - name.length + b.unread;
    // Fuzzy subsequence match.
    let j = 0;
    for (const ch of name) if (ch === query[j]) j++;
    return j === query.length ? 100 - name.length : -1;
  }

  const results = $derived(
    app
      .allBuffers()
      .map((b) => ({ b, s: score(b, q.toLowerCase().replace(/^[#@]/, (m) => (m === "#" ? "#" : ""))) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.b),
  );

  $effect(() => {
    void q;
    sel = 0;
  });

  function choose(b: Buffer | undefined) {
    if (b) app.setActive(b);
    onClose();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      sel = Math.min(sel + 1, results.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(sel - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[sel]);
    } else if (e.key === "Escape") onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="modal switcher">
    <!-- svelte-ignore a11y_autofocus -->
    <input autofocus placeholder={t("qs.placeholder")} bind:value={q} onkeydown={onKey} />
    <ul>
      {#each results as b, i (b.key)}
        <li>
          <button class:sel={i === sel} onclick={() => choose(b)} onmouseenter={() => (sel = i)}>
            <span class="name">{b.type === "server" ? b.network.displayName : b.name}</span>
            <span class="net">{b.type === "server" ? t("qs.network") : b.network.displayName}</span>
            {#if b.highlights}<span class="badge hl">{b.highlights}</span>{:else if b.unread}<span class="badge">{b.unread}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .switcher {
    max-width: 480px;
    overflow: hidden;
  }
  input {
    width: 100%;
    border: none;
    border-bottom: 1px solid var(--border);
    background: none;
    padding: 14px 16px;
    font-size: 1.05em;
    outline: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow-y: auto;
  }
  button {
    display: flex;
    gap: 10px;
    align-items: center;
    width: 100%;
    background: none;
    border: none;
    padding: 8px 10px;
    border-radius: var(--radius);
    text-align: left;
  }
  button.sel {
    background: var(--bg-3);
  }
  .name {
    flex: 1;
  }
  .net {
    color: var(--fg-faint);
    font-size: 0.85em;
  }
  .badge {
    font-size: 0.75em;
    background: var(--bg-hover);
    border-radius: 10px;
    padding: 0 7px;
  }
  .badge.hl {
    background: var(--hl);
    color: #fff;
  }
</style>
