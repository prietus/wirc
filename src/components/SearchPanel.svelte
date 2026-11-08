<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { locale, t } from "../lib/i18n.svelte";
  import type { Buffer, Line } from "../lib/state.svelte";
  import Modal from "./Modal.svelte";
  import MessageLine from "./MessageLine.svelte";

  let { buf, initial = "", onClose }: { buf: Buffer; initial?: string; onClose: () => void } = $props();

  let q = $state(initial);
  let from = $state("");
  let scope = $state<"buffer" | "network">(buf.type === "server" ? "network" : "buffer");
  let results = $state<Line[] | null>(null);
  let error = $state("");
  let loading = $state(false);

  const supported = $derived(buf.network.client.caps.has("soju.im/search"));

  async function run(e?: Event) {
    e?.preventDefault();
    if (!q.trim()) return;
    loading = true;
    error = "";
    try {
      results = await app.search(buf.network, q.trim(), {
        in: scope === "buffer" && buf.type !== "server" ? buf.name : undefined,
        from: from.trim() || undefined,
      });
    } catch (err) {
      error = (err as Error).message;
      results = null;
    } finally {
      loading = false;
    }
  }

  function jump(l: Line) {
    if (!l.target) return;
    app.setActive(buf.network.ensureBuffer(l.target));
    onClose();
  }

  if (initial) queueMicrotask(run);
</script>

<Modal title={t("search.title")} {onClose} wide>
  {#if !supported}
    <p class="dim">{t("search.unsupported")}</p>
  {:else}
    <form class="row" onsubmit={run}>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="q" autofocus placeholder={t("search.text")} bind:value={q} />
      <input class="from" placeholder={t("search.from")} bind:value={from} />
      <select bind:value={scope}>
        {#if buf.type !== "server"}<option value="buffer">{t("search.inBuffer", { name: buf.name })}</option>{/if}
        <option value="network">{t("search.inNetwork")}</option>
      </select>
      <button class="btn primary" disabled={loading}>{t("search.button")}</button>
    </form>
    {#if error}<p class="err">{error}</p>{/if}
    {#if results}
      <p class="dim">{results.length === 1 ? t("search.results1") : t("search.resultsN", { n: results.length })}{results.length >= 100 ? t("search.max") : ""}</p>
      <div class="results">
        {#each results as l (l.id)}
          <button class="hit" onclick={() => jump(l)}>
            <span class="where">{l.target} · {l.time.toLocaleDateString(locale())}</span>
            <MessageLine line={l} onNick={() => {}} />
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</Modal>

<style>
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .row input,
  .row select {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 6px 10px;
  }
  .q {
    flex: 2;
    min-width: 160px;
  }
  .from {
    flex: 1;
    min-width: 100px;
  }
  .dim {
    color: var(--fg-dim);
    font-size: 0.9em;
  }
  .err {
    color: var(--err);
  }
  .results {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .hit {
    background: none;
    border: none;
    text-align: left;
    padding: 4px 0;
    border-radius: var(--radius);
  }
  .hit:hover {
    background: var(--bg-3);
  }
  .where {
    font-size: 0.75em;
    color: var(--accent);
    padding-left: 16px;
  }
</style>
