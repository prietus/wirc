<script lang="ts">
  import { extractUrls, nickColor, stripFormatting } from "../irc/formatting";
  import { settings } from "../lib/settings.svelte";
  import { locale, t } from "../lib/i18n.svelte";
  import { mediaKind, QUICK_REACTIONS, type MediaKind } from "../lib/media";
  import type { Line, Reactions } from "../lib/state.svelte";
  import Rich from "./Rich.svelte";

  let {
    line,
    continuation = false,
    onNick,
    reactions,
    myNick = "",
    replyLine,
    canReact = false,
    canReply = false,
    onReply,
    onReact,
    onJump,
    onOpenImage,
    replies,
    reactionsFor,
  }: {
    line: Line;
    continuation?: boolean;
    onNick: (n: string) => void;
    reactions?: Reactions;
    myNick?: string;
    /** Resolved message this one replies to (null = not loaded). */
    replyLine?: Line | null;
    canReact?: boolean;
    canReply?: boolean;
    onReply?: (l: Line) => void;
    onReact?: (l: Line, emoji: string, remove: boolean) => void;
    onJump?: (msgid: string) => void;
    onOpenImage?: (src: string) => void;
    /** Replies nested under this message (thread). */
    replies?: Line[];
    reactionsFor?: (msgid: string) => Reactions | undefined;
  } = $props();

  let picker = $state(false);
  let failed = $state<Record<string, boolean>>({});

  function fmtTime(d: Date) {
    return d.toLocaleTimeString(locale(), {
      hour: "2-digit",
      minute: "2-digit",
      second: settings.showSeconds ? "2-digit" : undefined,
      hour12: settings.use12h,
    });
  }

  const isChat = $derived(line.kind === "privmsg" || line.kind === "notice" || line.kind === "action");
  const color = $derived(line.nick && settings.nickColors ? nickColor(line.nick) : undefined);
  const media = $derived.by(() => {
    if (!settings.inlineMedia || !isChat) return [] as { url: string; kind: MediaKind }[];
    const out: { url: string; kind: MediaKind }[] = [];
    for (const url of extractUrls(line.text)) {
      const kind = mediaKind(url, settings.mediaOrigins);
      if (kind && !out.some((m) => m.url === url)) out.push({ url, kind });
      if (out.length >= 4) break;
    }
    return out;
  });
  const reactionList = $derived(reactions ? Object.entries(reactions) : []);
  const mine = (nicks: string[]) => nicks.some((n) => n.toLowerCase() === myNick.toLowerCase());
  const showActions = $derived(!!line.msgid && isChat && (canReact || canReply) && (!!onReact || !!onReply));

  function react(emoji: string) {
    picker = false;
    const nicks = reactions?.[emoji] ?? [];
    onReact?.(line, emoji, mine(nicks));
  }

  function reactTo(target: Line, emoji: string, nicks: string[]) {
    onReact?.(target, emoji, mine(nicks));
  }

  function customEmoji() {
    const e = prompt(t("msg.customEmoji"))?.trim();
    if (e) react(e);
  }

  function snippet(l: Line) {
    const s = stripFormatting(l.text);
    return s.length > 120 ? s.slice(0, 120) + "…" : s;
  }
</script>

<div
  class="line {line.kind}"
  class:highlight={line.highlight}
  class:self={line.self}
  class:event={!isChat}
  class:cont={continuation && !line.replyTo}
  data-msgid={line.msgid}
  data-nick={line.nick}
>
  {#if line.replyTo}
    <button class="reply-ref" onclick={() => line.replyTo && onJump?.(line.replyTo)}>
      ↪
      {#if replyLine}
        <b style:color={replyLine.nick && settings.nickColors ? nickColor(replyLine.nick) : undefined}>{replyLine.nick}</b>
        <span class="snippet">{snippet(replyLine)}</span>
      {:else}
        <span class="snippet">{t("msg.earlier")}</span>
      {/if}
    </button>
  {/if}

  <time datetime={line.ts} title={line.time.toLocaleString(locale())}>{fmtTime(line.time)}</time>
  {#if line.kind === "privmsg"}
    <button class="nick" style:color={color} onclick={() => onNick(line.nick!)}>{continuation && !line.replyTo ? "" : line.nick}</button>
    <span class="text"><Rich text={line.text} /></span>
  {:else if line.kind === "notice"}
    <button class="nick" style:color={color} onclick={() => onNick(line.nick!)}>-{line.nick}-</button>
    <span class="text"><Rich text={line.text} /></span>
  {:else if line.kind === "action"}
    <span class="nick">*</span>
    <span class="text"
      ><button class="inline-nick" style:color={color} onclick={() => onNick(line.nick!)}>{line.nick}</button>
      <Rich text={line.text} /></span
    >
  {:else}
    <span class="nick sym">
      {#if line.kind === "join"}→{:else if line.kind === "part" || line.kind === "quit" || line.kind === "kick"}←{:else if line.kind === "error"}!{:else}–{/if}
    </span>
    <span class="text">
      {#if line.kind === "join"}
        <b style:color={color}>{line.nick}</b> {t("line.joined")}
      {:else if line.kind === "part"}
        <b style:color={color}>{line.nick}</b> {t("line.left")}{#if line.text}&nbsp;(<Rich text={line.text} />){/if}
      {:else if line.kind === "quit"}
        <b style:color={color}>{line.nick}</b> {t("line.quit")}{#if line.text}&nbsp;(<Rich text={line.text} />){/if}
      {:else if line.kind === "nick"}
        <b style:color={color}>{line.nick}</b> {t("line.nowKnownAs")} <b>{line.text}</b>
      {:else if line.kind === "kick"}
        <b style:color={color}>{line.nick}</b> {t("line.kicked")} {line.text}
      {:else if line.kind === "topic"}
        <b style:color={color}>{line.nick}</b> {t("line.topicChanged")} <Rich text={line.text} />
      {:else if line.kind === "mode"}
        <b style:color={color}>{line.nick}</b> {t("line.setsMode")} <code>{line.text}</code>
      {:else if line.kind === "invite"}
        <b style:color={color}>{line.nick}</b> {t("line.invites")} <b>{line.text}</b>
      {:else}
        <Rich text={line.text} />
      {/if}
    </span>
  {/if}

  {#if media.length}
    <div class="media">
      {#each media as m (m.url)}
        {#if failed[m.url]}{:else if m.kind === "image"}
          <button class="thumb" onclick={() => onOpenImage?.(m.url)}>
            <img
              src={m.url}
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
              onerror={() => (failed[m.url] = true)}
            />
          </button>
        {:else if m.kind === "video"}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={m.url} controls preload="metadata" onerror={() => (failed[m.url] = true)}></video>
        {:else}
          <audio src={m.url} controls preload="none"></audio>
        {/if}
      {/each}
    </div>
  {/if}

  {#if reactionList.length}
    <div class="reactions">
      {#each reactionList as [emoji, nicks] (emoji)}
        <button
          class="chip"
          class:mine={mine(nicks)}
          disabled={!canReact || !line.msgid}
          title={t("msg.reactedBy", { nicks: nicks.join(", "), emoji })}
          onclick={() => react(emoji)}
        >
          <span class="emoji">{emoji}</span>
          {nicks.length}
        </button>
      {/each}
    </div>
  {/if}

  {#if replies?.length}
    <div class="thread">
      {#each replies as r (r.id)}
        {@const rr = r.msgid ? reactionsFor?.(r.msgid) : undefined}
        <div class="treply" class:highlight={r.highlight} data-msgid={r.msgid} data-nick={r.nick}>
          <span class="tarrow">↳</span>
          <span class="tbody">
            {#if r.kind === "action"}
              <span class="tnick" style:color={r.nick && settings.nickColors ? nickColor(r.nick) : undefined}>* {r.nick}</span>
            {:else}
              <button
                class="tnick"
                style:color={r.nick && settings.nickColors ? nickColor(r.nick) : undefined}
                onclick={() => onNick(r.nick!)}>{r.nick}:</button
              >
            {/if}
            <span class="ttext"><Rich text={r.text} /></span>
            {#if rr}
              {#each Object.entries(rr) as [emoji, nicks] (emoji)}
                <button
                  class="chip small"
                  class:mine={mine(nicks)}
                  disabled={!canReact}
                  title={t("msg.reactedBy", { nicks: nicks.join(", "), emoji })}
                  onclick={() => reactTo(r, emoji, nicks)}><span class="emoji">{emoji}</span> {nicks.length}</button
                >
              {/each}
            {/if}
          </span>
          <time class="ttime" datetime={r.ts} title={r.time.toLocaleString(locale())}>{fmtTime(r.time)}</time>
          {#if canReply && onReply && r.msgid}
            <button class="tact" title={t("msg.reply")} onclick={() => onReply(r)}>↩</button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if showActions}
    <div class="actions" class:open={picker}>
      {#if canReact && onReact}
        <button class="act" title={t("msg.react")} onclick={() => (picker = !picker)}>☺︎</button>
      {/if}
      {#if canReply && onReply}
        <button class="act" title={t("msg.reply")} onclick={() => onReply(line)}>↩</button>
      {/if}
      {#if picker}
        <div class="picker">
          {#each QUICK_REACTIONS as e (e)}
            <button onclick={() => react(e)}>{e}</button>
          {/each}
          <button class="more" onclick={customEmoji}>{t("msg.customEmoji")}</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .line {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(60px, 140px) 1fr;
    column-gap: 10px;
    padding: 1px 16px;
    align-items: baseline;
  }
  .line:hover {
    background: var(--bg-2);
  }
  .line.highlight {
    background: var(--hl-bg);
    box-shadow: inset 3px 0 0 var(--hl);
  }
  :global(.line.flash),
  :global(.treply.flash) {
    animation: flash 1.6s ease;
  }
  @keyframes flash {
    0%,
    40% {
      background: color-mix(in srgb, var(--accent) 25%, transparent);
    }
  }
  time {
    color: var(--fg-faint);
    font-family: var(--mono);
    font-size: 0.78em;
    white-space: nowrap;
  }
  .nick {
    text-align: right;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: none;
    border: none;
    padding: 0;
    color: var(--fg-dim);
  }
  .nick.sym {
    color: var(--fg-faint);
    font-weight: normal;
  }
  .inline-nick {
    background: none;
    border: none;
    padding: 0;
    font-weight: 600;
  }
  .text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .event .text {
    color: var(--fg-dim);
    font-size: 0.92em;
  }
  .notice .text {
    color: var(--warn);
  }
  .action .text {
    font-style: italic;
  }
  .error .text {
    color: var(--err);
  }
  .self .nick {
    opacity: 0.85;
  }
  code {
    font-family: var(--mono);
    font-size: 0.9em;
  }

  .reply-ref {
    grid-column: 3;
    display: flex;
    gap: 6px;
    align-items: baseline;
    min-width: 0;
    background: none;
    border: none;
    padding: 2px 0 0;
    text-align: left;
    font-size: 0.85em;
    color: var(--fg-dim);
  }
  .reply-ref:hover .snippet {
    color: var(--fg);
  }
  .snippet {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .media,
  .reactions {
    grid-column: 3;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 4px 0;
  }
  .thumb {
    padding: 0;
    border: none;
    background: none;
    cursor: zoom-in;
  }
  .thumb img,
  video {
    display: block;
    max-height: var(--media-h, 280px);
    max-width: min(var(--media-w, 420px), 100%);
    border-radius: var(--radius);
  }
  audio {
    max-width: 100%;
  }

  .reactions {
    gap: 4px;
    padding-top: 2px;
  }

  .thread {
    grid-column: 3;
    display: flex;
    flex-direction: column;
    padding: 1px 0 3px;
  }
  .treply {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 1px 4px 1px 2px;
    border-radius: 4px;
    min-width: 0;
  }
  .treply:hover {
    background: var(--bg-3);
  }
  .treply.highlight {
    background: var(--hl-bg);
  }
  .tarrow {
    color: var(--fg-faint);
    flex: none;
  }
  .tbody {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .tnick {
    background: none;
    border: none;
    padding: 0;
    font-weight: 600;
    margin-right: 4px;
  }
  .ttime,
  .tact {
    flex: none;
    opacity: 0;
    color: var(--fg-faint);
    font-size: 0.75em;
  }
  .ttime {
    font-family: var(--mono);
  }
  .tact {
    background: none;
    border: none;
    padding: 0 4px;
    font-size: 0.9em;
  }
  .treply:hover .ttime,
  .treply:hover .tact {
    opacity: 1;
  }
  .chip.small {
    font-size: 0.72em;
    padding: 0 6px;
    margin-left: 4px;
    vertical-align: 1px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8em;
    padding: 1px 8px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--fg-dim);
  }
  .chip.mine {
    border-color: var(--accent);
    color: var(--fg);
    background: color-mix(in srgb, var(--accent) 15%, var(--bg-2));
  }
  .chip:disabled {
    cursor: default;
  }
  .emoji {
    font-size: 1.15em;
  }

  .actions {
    position: absolute;
    right: 12px;
    top: -14px;
    display: none;
    gap: 2px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 2px;
    z-index: 5;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  .line:hover .actions,
  .actions.open {
    display: flex;
  }
  .act {
    background: none;
    border: none;
    padding: 2px 8px;
    border-radius: 4px;
    color: var(--fg-dim);
  }
  .act:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .picker {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    display: grid;
    grid-template-columns: repeat(6, 32px);
    gap: 2px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
  }
  .picker button {
    background: none;
    border: none;
    font-size: 1.2em;
    border-radius: 4px;
    padding: 2px;
  }
  .picker button:hover {
    background: var(--bg-hover);
  }
  .picker .more {
    grid-column: 1 / -1;
    font-size: 0.8em;
    color: var(--fg-dim);
  }

  :global(.compact) .line {
    padding-top: 0;
    padding-bottom: 0;
    line-height: 1.3;
  }
  @media (max-width: 700px) {
    .line {
      grid-template-columns: auto 1fr;
    }
    .line .nick {
      text-align: left;
    }
    .line .text,
    .thread,
    .reply-ref,
    .media,
    .reactions {
      grid-column: 1 / -1;
    }
    .line.cont .nick {
      display: none;
    }
  }
</style>
