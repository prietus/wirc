<script lang="ts">
  import BufferView from "./components/BufferView.svelte";
  import Login from "./components/Login.svelte";
  import NetworkDialog from "./components/NetworkDialog.svelte";
  import QuickSwitcher from "./components/QuickSwitcher.svelte";
  import SearchPanel from "./components/SearchPanel.svelte";
  import SettingsDialog from "./components/SettingsDialog.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import { app, toasts } from "./lib/app.svelte";
  import { settings } from "./lib/settings.svelte";
  import { t } from "./lib/i18n.svelte";
  import type { Network } from "./lib/state.svelte";

  let showSwitcher = $state(false);
  let showSettings = $state(false);
  let search = $state<{ q: string } | null>(null);
  let networkDialog = $state<{ network?: Network } | null>(null);
  let sidebarOpen = $state(false);
  let view: BufferView | undefined = $state();

  const ui = {
    openSearch: (q = "") => (search = { q }),
    openSettings: () => (showSettings = true),
    openAddNetwork: () => (networkDialog = {}),
  };

  // Theme + font size.
  $effect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark =
        settings.theme === "dark" ||
        (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    root.style.setProperty("--font-size", settings.fontSize + "px");
    root.lang = settings.language;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  });

  // Close the mobile sidebar when switching buffers; refocus the composer.
  $effect(() => {
    void app.active;
    sidebarOpen = false;
    if (window.matchMedia("(pointer: fine)").matches) queueMicrotask(() => view?.focusComposer());
  });

  function cycle(delta: number, onlyActivity = false) {
    const all = app.allBuffers();
    if (!all.length) return;
    const i = app.active ? all.indexOf(app.active) : -1;
    for (let k = 1; k <= all.length; k++) {
      const b = all[(i + delta * k + all.length * k) % all.length];
      if (!onlyActivity || b.unread || b.highlights) {
        app.setActive(b);
        return;
      }
    }
  }

  function nextActivity() {
    // Highlights first, then any unread.
    const hl = app.allBuffers().find((b) => b.highlights && b !== app.active);
    if (hl) app.setActive(hl);
    else cycle(1, true);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!app.login || app.status === "idle") return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      showSwitcher = !showSwitcher;
    } else if (mod && e.key.toLowerCase() === "f" && app.active) {
      e.preventDefault();
      ui.openSearch();
    } else if (mod && e.key === ",") {
      e.preventDefault();
      showSettings = true;
    } else if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
      e.preventDefault();
      const b = app.allBuffers()[parseInt(e.code.slice(5), 10) - 1];
      if (b) app.setActive(b);
    } else if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      cycle(-1);
    } else if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      cycle(1);
    } else if (e.altKey && e.code === "KeyA") {
      e.preventDefault();
      nextActivity();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if !app.login || (app.status !== "ready" && !app.networks.size) || app.status === "error"}
  <Login />
{:else}
  <div class="layout" class:sidebar-open={sidebarOpen}>
    <div class="sidebar-col">
      <Sidebar
        onSettings={() => (showSettings = true)}
        onAddNetwork={() => (networkDialog = {})}
        onEditNetwork={(n) => (networkDialog = { network: n })}
      />
    </div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="scrim" onclick={() => (sidebarOpen = false)}></div>
    <main>
      {#if app.active}
        <BufferView bind:this={view} buf={app.active} {ui} onToggleSidebar={() => (sidebarOpen = !sidebarOpen)} />
      {:else}
        <div class="empty">{t("buf.connecting")}</div>
      {/if}
    </main>
  </div>
{/if}

{#if showSwitcher}<QuickSwitcher onClose={() => (showSwitcher = false)} />{/if}
{#if showSettings}<SettingsDialog onClose={() => (showSettings = false)} />{/if}
{#if search && app.active}
  <SearchPanel buf={app.active} initial={search.q} onClose={() => (search = null)} />
{/if}
{#if networkDialog}
  <NetworkDialog network={networkDialog.network} onClose={() => (networkDialog = null)} />
{/if}

<div class="toasts">
  {#each toasts as t (t.id)}
    <div class="toast {t.kind}">{t.text}</div>
  {/each}
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
    overflow: hidden;
  }
  .sidebar-col,
  main {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .scrim {
    display: none;
  }
  .empty {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--fg-dim);
  }
  @media (max-width: 700px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .sidebar-col {
      position: fixed;
      inset: 0 auto 0 0;
      width: min(280px, 85vw);
      z-index: 20;
      transform: translateX(-100%);
      transition: transform 0.18s ease;
    }
    .sidebar-open .sidebar-col {
      transform: none;
    }
    .sidebar-open .scrim {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 10;
    }
  }
  .toasts {
    position: fixed;
    bottom: 80px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 100;
    max-width: calc(100vw - 32px);
  }
  .toast {
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 14px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
    font-size: 0.9em;
  }
  .toast.error {
    border-color: var(--err);
    color: var(--err);
  }
</style>
