<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "../lib/i18n.svelte";

  let { title, onClose, children, footer, wide = false }: {
    title: string;
    onClose: () => void;
    children: Snippet;
    footer?: Snippet;
    wide?: boolean;
  } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="modal" style:max-width={wide ? "760px" : undefined} role="dialog" aria-label={title}>
    <header>
      <h2>{title}</h2>
      <button class="icon-btn" onclick={onClose} aria-label={t("modal.close")}>✕</button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</div>
