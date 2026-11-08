<script lang="ts">
  import { tick } from "svelte";
  import { app } from "../lib/app.svelte";
  import { locale, t } from "../lib/i18n.svelte";
  import {
    filterPresence,
    joinPartModeFor,
    saveSettings,
    setJoinPartMode,
    settings,
    type JoinPartMode,
  } from "../lib/settings.svelte";
  import type { Buffer, Line } from "../lib/state.svelte";
  import Composer from "./Composer.svelte";
  import Lightbox from "./Lightbox.svelte";
  import MemberList from "./MemberList.svelte";
  import MessageLine from "./MessageLine.svelte";
  import Rich from "./Rich.svelte";

  let { buf, ui, onToggleSidebar }: {
    buf: Buffer;
    ui: { openSearch(q?: string): void; openSettings(): void; openAddNetwork(): void };
    onToggleSidebar: () => void;
  } = $props();

  let scroller: HTMLDivElement;
  let composer: Composer;
  let atBottom = true;
  let prevKey = "";
  let prevFirstId = -1;
  let prevHeight = 0;
  let prevTop = 0;
  let topicExpanded = $state(false);
  /** Read marker as it was when the buffer was opened, for the "new" separator. */
  let markerSnapshot = $state<string | null>(null);
  let now = $state(Date.now());
  let content: HTMLDivElement;
  let replyTo = $state<Line | null>(null);
  let lightbox = $state<string | null>(null);
  let dragDepth = $state(0);
  /** Live replies nested in a thread that is currently off-screen. */
  let pendingReplies = $state<Line[]>([]);
  let openedAt = "";
  let knownNested = new Set<number>();

  const net = $derived(buf.network);
  const canReact = $derived(buf.type !== "server" && net.canReact);
  const canReply = $derived(buf.type !== "server" && net.canReply);
  const byMsgid = $derived.by(() => {
    const m = new Map<string, Line>();
    for (const l of buf.lines) if (l.msgid) m.set(l.msgid, l);
    return m;
  });
  const canUpload = $derived(!!app.fileHost(net) && buf.type !== "server");

  const jpMode = $derived(joinPartModeFor(buf.key));
  /**
   * Replies whose original is loaded are shown nested under the thread root
   * (flattened: a reply to a reply goes under the same root) and removed from
   * the main flow.
   */
  const threads = $derived.by(() => {
    const children = new Map<string, Line[]>();
    const nested = new Set<number>();
    for (const l of buf.lines) {
      if (!l.replyTo || !byMsgid.has(l.replyTo)) continue;
      let root = byMsgid.get(l.replyTo)!;
      const seen = new Set<string>();
      while (root.replyTo && byMsgid.has(root.replyTo) && !seen.has(root.replyTo)) {
        seen.add(root.replyTo);
        root = byMsgid.get(root.replyTo)!;
      }
      if (!root.msgid || root === l) continue;
      nested.add(l.id);
      const list = children.get(root.msgid);
      if (list) list.push(l);
      else children.set(root.msgid, [l]);
    }
    return { children, nested };
  });
  const visible = $derived(
    buf.type === "server"
      ? buf.lines
      : filterPresence(buf.lines, jpMode).filter((l) => !threads.nested.has(l.id)),
  );

  const JP_NEXT: Record<JoinPartMode, JoinPartMode> = { show: "smart", smart: "hide", hide: "show" };

  const typers = $derived.by(() => {
    if (!settings.showTyping) return [];
    return [...buf.typing.entries()].filter(([, exp]) => exp > now).map(([n]) => n);
  });

  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  export function focusComposer() {
    composer?.focus();
  }

  // Measure before the DOM updates so we can keep the scroll position stable.
  $effect.pre(() => {
    void visible;
    if (!scroller) return;
    prevHeight = scroller.scrollHeight;
    prevTop = scroller.scrollTop;
  });

  $effect(() => {
    const lines = visible;
    const key = buf.key;
    if (key !== prevKey) {
      prevKey = key;
      markerSnapshot = buf.readMarker;
      topicExpanded = false;
      replyTo = null;
      pendingReplies = [];
      openedAt = new Date().toISOString();
      knownNested = new Set(threads.nested);
      atBottom = true;
      tick().then(() => {
        scroller.scrollTop = scroller.scrollHeight;
        maybeLoadMore();
      });
    } else if (atBottom) {
      scroller.scrollTop = scroller.scrollHeight;
    } else if (lines[0] && lines[0].id !== prevFirstId) {
      // Older history was prepended: keep what the user is looking at in place.
      scroller.scrollTop = prevTop + (scroller.scrollHeight - prevHeight);
    }
    prevFirstId = lines[0]?.id ?? -1;
  });

  // Media loads after render: keep the view pinned to the bottom while it grows.
  $effect(() => {
    if (!content) return;
    const ro = new ResizeObserver(() => {
      if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  });

  // Detect live replies that got nested under an off-screen message.
  $effect(() => {
    const nested = threads.nested;
    const fresh: Line[] = [];
    for (const l of buf.lines) {
      if (!nested.has(l.id) || knownNested.has(l.id)) continue;
      knownNested.add(l.id);
      if (!l.self && openedAt && l.ts >= openedAt && l.msgid) fresh.push(l);
    }
    if (!fresh.length) return;
    tick().then(() => {
      const hidden = fresh.filter((l) => !isOnScreen(l.msgid!));
      if (hidden.length) pendingReplies = [...pendingReplies, ...hidden];
    });
  });

  function isOnScreen(msgid: string): boolean {
    const el = scroller?.querySelector<HTMLElement>(`[data-msgid="${CSS.escape(msgid)}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const v = scroller.getBoundingClientRect();
    return r.bottom > v.top && r.top < v.bottom;
  }

  function prunePending() {
    if (pendingReplies.length) pendingReplies = pendingReplies.filter((l) => !isOnScreen(l.msgid!));
  }

  function showPending() {
    const l = pendingReplies[pendingReplies.length - 1];
    if (!l?.msgid) return;
    pendingReplies = pendingReplies.slice(0, -1);
    jumpTo(l.msgid);
  }

  function onReply(l: Line) {
    replyTo = l;
    composer?.focus();
  }

  function onReact(l: Line, emoji: string, remove: boolean) {
    if (l.msgid) net.sendReaction(buf, l.msgid, emoji, remove);
  }

  function jumpTo(msgid: string) {
    const el = scroller.querySelector<HTMLElement>(`[data-msgid="${CSS.escape(msgid)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }

  function onDragEnter(e: DragEvent) {
    if (!canUpload || !e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragDepth++;
  }

  function onDrop(e: DragEvent) {
    if (!canUpload) return;
    e.preventDefault();
    dragDepth = 0;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void composer?.upload(files);
  }

  function onScroll() {
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    prunePending();
    maybeLoadMore();
  }

  function maybeLoadMore() {
    if (scroller.scrollTop < 300 && !buf.historyExhausted && !buf.historyLoading) {
      void app.fetchHistory(buf, "before");
    }
  }

  function sameDay(a: Date, b: Date) {
    return a.toDateString() === b.toDateString();
  }

  function dayLabel(d: Date) {
    const today = new Date();
    const yest = new Date(Date.now() - 86400000);
    if (sameDay(d, today)) return t("buf.today");
    if (sameDay(d, yest)) return t("buf.yesterday");
    return d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  function isContinuation(prev: Line | undefined, l: Line) {
    return (
      !!prev &&
      prev.kind === "privmsg" &&
      l.kind === "privmsg" &&
      prev.nick === l.nick &&
      l.time.getTime() - prev.time.getTime() < 5 * 60_000
    );
  }

  function onNick(nick: string) {
    composer?.insertNick(nick);
  }

  function openQuery(nick: string) {
    app.setActive(buf.network.ensureBuffer(nick));
  }

  function toggleMembers() {
    settings.showMemberList = !settings.showMemberList;
    saveSettings();
  }

  const bouncerError = $derived(
    buf.network.attrs["state"] === "disconnected" ? buf.network.attrs["error"] || t("buf.netDisconnected") : "",
  );
</script>

<div class="view">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="main"
    class:dragging={dragDepth > 0}
    data-drop-label={t("up.drop")}
    ondragenter={onDragEnter}
    ondragover={(e) => canUpload && e.preventDefault()}
    ondragleave={() => (dragDepth = Math.max(0, dragDepth - 1))}
    ondrop={onDrop}
  >
    <header>
      <button class="icon-btn menu" onclick={onToggleSidebar} aria-label={t("buf.menu")}>☰</button>
      <div class="title">
        <h2>{buf.type === "server" ? buf.network.displayName : buf.name}</h2>
        {#if buf.type === "channel"}
          <button class="topic" class:expanded={topicExpanded} onclick={() => (topicExpanded = !topicExpanded)}>
            {#if buf.topic}<Rich text={buf.topic} />{:else}<span class="dim">{t("buf.noTopic")}</span>{/if}
          </button>
        {:else if buf.type === "query" && buf.away}
          <span class="topic dim">{t("buf.away")}</span>
        {:else if buf.type === "server"}
          <span class="topic dim">
            {buf.network.attrs["host"] ?? ""}{buf.network.state !== "registered" ? ` · ${buf.network.state}` : ""}
          </span>
        {/if}
      </div>
      <div class="actions">
        {#if buf.type !== "server" && net.supportsTargetMeta}
          {@const meta = buf.meta}
          <button
            class="icon-btn meta"
            class:on={meta.pinned}
            title={(meta.pinned ? t("meta.unpin") : t("meta.pin")) + " — " + t("meta.synced")}
            onclick={() => net.setTargetMeta(buf, "pinned", !meta.pinned)}>📌</button
          >
          <button
            class="icon-btn meta"
            class:on={meta.muted}
            title={(meta.muted ? t("meta.unmute") : t("meta.mute")) + " — " + t("meta.synced")}
            onclick={() => net.setTargetMeta(buf, "muted", !meta.muted)}>{meta.muted ? "🔕" : "🔔"}</button
          >
          {#if buf.type === "query"}
            <button
              class="icon-btn meta"
              class:on={meta.blocked}
              title={(meta.blocked ? t("meta.unblock") : t("meta.block")) + " — " + t("meta.synced")}
              onclick={() => net.setTargetMeta(buf, "blocked", !meta.blocked)}>⛔</button
            >
          {/if}
        {/if}
        {#if buf.type !== "server"}
          <button
            class="icon-btn jp"
            class:on={jpMode !== "show"}
            title={t(`jp.title.${jpMode}`) + " " + t("jp.clickHint")}
            onclick={() => setJoinPartMode(buf.key, JP_NEXT[jpMode])}
          >
            {t(`jp.${jpMode}`)}
          </button>
        {/if}
        <button class="icon-btn" title={t("buf.search")} onclick={() => ui.openSearch()}>⌕</button>
        {#if buf.type === "channel"}
          <button class="icon-btn" class:on={settings.showMemberList} title={t("buf.users")} onclick={toggleMembers}>
            👥 {buf.members.size}
          </button>
        {/if}
      </div>
    </header>

    {#if bouncerError}
      <div class="banner">⚠ {bouncerError}</div>
    {/if}
    {#if buf.network.state !== "registered"}
      <div class="banner">{t("buf.reconnecting")}</div>
    {/if}

    <div class="scroller" class:compact={settings.compact} bind:this={scroller} onscroll={onScroll}>
      {#if buf.historyLoading}
        <div class="status">{t("buf.loadingHistory")}</div>
      {:else if buf.historyExhausted || buf.type === "server"}
        <div class="status">{t("buf.startOfConversation")}</div>
      {/if}
      <div class="content" bind:this={content}>
      {#each visible as line, i (line.id)}
        {@const prev = visible[i - 1]}
        {#if !prev || !sameDay(prev.time, line.time)}
          <div class="sep day"><span>{dayLabel(line.time)}</span></div>
        {/if}
        {#if markerSnapshot && prev && prev.ts <= markerSnapshot && line.ts > markerSnapshot && !line.self}
          <div class="sep unread"><span>{t("buf.new")}</span></div>
        {/if}
        <MessageLine
          {line}
          continuation={isContinuation(prev, line)}
          {onNick}
          reactions={line.msgid ? buf.reactions.get(line.msgid) : undefined}
          myNick={net.nick}
          replyLine={line.replyTo ? (byMsgid.get(line.replyTo) ?? null) : undefined}
          replies={line.msgid ? threads.children.get(line.msgid) : undefined}
          reactionsFor={(id) => buf.reactions.get(id)}
          {canReact}
          {canReply}
          {onReply}
          {onReact}
          onJump={jumpTo}
          onOpenImage={(src) => (lightbox = src)}
        />
      {/each}
      </div>
    </div>

    {#if pendingReplies.length}
      {@const last = pendingReplies[pendingReplies.length - 1]}
      <div class="pending-wrap">
        <button class="pending" onclick={showPending}>
          ↑ {pendingReplies.length === 1
            ? t("thread.newReply", { nick: last.nick ?? "" })
            : t("thread.newReplies", { n: pendingReplies.length })}
        </button>
        <button class="pending-x" aria-label={t("modal.close")} onclick={() => (pendingReplies = [])}>✕</button>
      </div>
    {/if}

    <div class="typing">
      {#if typers.length}
        {@const shownNames = typers.slice(0, 3).join(", ")}
        {@const names = typers.length > 3 ? t("buf.andMore", { names: shownNames, n: typers.length - 3 }) : shownNames}
        {t(typers.length === 1 ? "buf.typing1" : "buf.typingN", { names })}
      {/if}
    </div>
    <Composer bind:this={composer} {buf} {ui} {replyTo} {canUpload} onCancelReply={() => (replyTo = null)} />
  </div>

  {#if lightbox}<Lightbox src={lightbox} onClose={() => (lightbox = null)} />{/if}

  {#if buf.type === "channel" && settings.showMemberList}
    <div class="members-col">
      <MemberList {buf} onNick={openQuery} />
    </div>
  {/if}
</div>

<style>
  .view {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
  }
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    position: relative;
  }
  .main.dragging::after {
    content: attr(data-drop-label);
    position: absolute;
    inset: 8px;
    border: 2px dashed var(--accent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg) 80%, transparent);
    display: grid;
    place-items: center;
    font-size: 1.2em;
    color: var(--accent);
    pointer-events: none;
    z-index: 30;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    min-height: 48px;
  }
  .menu {
    display: none;
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
    white-space: nowrap;
  }
  .topic {
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    color: var(--fg-dim);
    font-size: 0.9em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }
  .topic.expanded {
    white-space: pre-wrap;
  }
  .dim {
    color: var(--fg-faint);
  }
  .actions {
    display: flex;
    gap: 4px;
    flex: none;
  }
  .jp {
    font-size: 0.8em;
  }
  .meta:not(.on) {
    filter: grayscale(1);
    opacity: 0.45;
  }
  .meta:not(.on):hover {
    opacity: 0.8;
  }
  .banner {
    background: var(--hl-bg);
    color: var(--warn);
    padding: 6px 16px;
    font-size: 0.9em;
  }
  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 0;
    overflow-anchor: none;
  }
  .status {
    text-align: center;
    color: var(--fg-faint);
    font-size: 0.85em;
    padding: 12px;
  }
  .sep {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 10px 16px;
    font-size: 0.75em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-faint);
  }
  .sep::before,
  .sep::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .sep.unread {
    color: var(--hl);
  }
  .sep.unread::before,
  .sep.unread::after {
    background: var(--hl);
    opacity: 0.5;
  }
  .pending-wrap {
    position: relative;
    height: 0;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    z-index: 10;
  }
  .pending-wrap > * {
    position: relative;
    top: -40px;
  }
  .pending {
    background: var(--accent);
    color: var(--accent-fg);
    border: none;
    border-radius: 16px 0 0 16px;
    padding: 5px 12px 5px 14px;
    font-size: 0.85em;
    font-weight: 600;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }
  .pending-x {
    background: var(--accent);
    color: var(--accent-fg);
    border: none;
    border-left: 1px solid color-mix(in srgb, var(--accent-fg) 25%, transparent);
    border-radius: 0 16px 16px 0;
    padding: 5px 10px 5px 8px;
    font-size: 0.75em;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }
  .typing {
    height: 20px;
    padding: 0 16px;
    font-size: 0.8em;
    color: var(--fg-dim);
    font-style: italic;
  }
  .members-col {
    width: 160px;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  @media (max-width: 900px) {
    .members-col {
      display: none;
    }
  }
  @media (max-width: 700px) {
    .menu {
      display: block;
    }
    .title {
      flex-direction: column;
      gap: 0;
    }
  }
</style>
