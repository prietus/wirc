<script lang="ts">
  import { t } from "../lib/i18n.svelte";

  let { src, onClose }: { src: string; onClose: () => void } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="lightbox" onclick={onClose}>
  <img {src} alt="" referrerpolicy="no-referrer" />
  <div class="bar">
    <a href={src} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{t("msg.openOriginal")} ↗</a>
    <button class="icon-btn" onclick={onClose} aria-label={t("modal.close")}>✕</button>
  </div>
</div>

<style>
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.85);
    display: grid;
    place-items: center;
    padding: 48px 16px 16px;
    cursor: zoom-out;
  }
  img {
    max-width: 100%;
    max-height: calc(100vh - 80px);
    object-fit: contain;
    border-radius: 4px;
  }
  .bar {
    position: fixed;
    top: 8px;
    right: 12px;
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .bar a {
    color: #fff;
    font-size: 0.9em;
  }
  .bar .icon-btn {
    color: #fff;
  }
</style>
