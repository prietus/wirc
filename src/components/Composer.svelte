<script lang="ts" module>
  const drafts = new Map<string, string>();
  const sentHistory: string[] = [];
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { app, toast } from "../lib/app.svelte";
  import { completeCommand, execute } from "../lib/commands";
  import { saveSettings, settings } from "../lib/settings.svelte";
  import { stripFormatting } from "../irc/formatting";
  import { t } from "../lib/i18n.svelte";
  import type { Buffer, Line } from "../lib/state.svelte";

  let {
    buf,
    ui,
    replyTo = null,
    canUpload = false,
    onCancelReply = () => {},
  }: {
    buf: Buffer;
    ui: { openSearch(q?: string): void; openSettings(): void; openAddNetwork(): void };
    replyTo?: Line | null;
    canUpload?: boolean;
    onCancelReply?: () => void;
  } = $props();

  let fileInput: HTMLInputElement | undefined = $state();
  let uploading = $state(0);

  /** Upload files to soju's filehost and insert their URLs. */
  export async function upload(files: File[]) {
    const net = buf.network;
    for (const file of files) {
      uploading++;
      toast(t("up.uploading", { name: file.name || "file" }));
      try {
        const url = await app.uploadFile(net, file);
        const origin = new URL(url).origin;
        if (!settings.mediaOrigins.includes(origin)) {
          settings.mediaOrigins.push(origin);
          saveSettings();
        }
        insert((text && !/\s$/.test(text) ? " " : "") + url + " ");
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        uploading--;
      }
    }
  }

  function onPaste(e: ClipboardEvent) {
    if (!canUpload) return;
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    void upload(files);
  }

  let text = $state("");
  let el: HTMLTextAreaElement;
  let histIdx = -1;
  let completion: { prefix: string; start: number; options: string[]; idx: number } | null = null;
  let lastTypingSent = 0;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;
  let currentKey = "";

  // Swap drafts when changing buffer.
  $effect.pre(() => {
    const key = buf.key;
    if (key === currentKey) return;
    if (currentKey) drafts.set(currentKey, text);
    currentKey = key;
    text = drafts.get(key) ?? "";
    histIdx = -1;
    completion = null;
    tick().then(autosize);
  });

  export function focus() {
    el?.focus({ preventScroll: true });
  }

  export function insert(s: string) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    text = text.slice(0, start) + s + text.slice(end);
    tick().then(() => {
      el.focus({ preventScroll: true });
      el.selectionStart = el.selectionEnd = start + s.length;
      autosize();
    });
  }

  export function insertNick(nick: string) {
    if (!text.trim()) insert(`${nick}: `);
    else insert(`${nick} `);
  }

  function autosize() {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  function canType() {
    const c = buf.network.client;
    return settings.sendTyping && buf.type !== "server" && buf.network.canSendTag("+typing") && c.connected;
  }

  function sendTyping(state: "active" | "paused" | "done") {
    if (!canType()) return;
    buf.network.client.sendMsg({ tags: { "+typing": state }, command: "TAGMSG", params: [buf.name] });
  }

  function onInput() {
    autosize();
    completion = null;
    if (text.startsWith("/") || !text) {
      if (!text && lastTypingSent) {
        sendTyping("done");
        lastTypingSent = 0;
      }
      return;
    }
    const now = Date.now();
    if (now - lastTypingSent > 3000) {
      sendTyping("active");
      lastTypingSent = now;
    }
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (lastTypingSent) sendTyping("paused");
      lastTypingSent = 0;
    }, 6000);
  }

  async function submit() {
    const input = text.replace(/\s+$/, "");
    if (!input) return;
    const lines = input.split("\n");
    if (lines.length > 5 && !input.startsWith("/") && !confirm(t("comp.confirmLines", { n: lines.length }))) return;
    text = "";
    drafts.delete(buf.key);
    histIdx = -1;
    if (typingTimer) clearTimeout(typingTimer);
    lastTypingSent = 0;
    if (sentHistory[sentHistory.length - 1] !== input) sentHistory.push(input);
    if (sentHistory.length > 200) sentHistory.shift();
    await tick();
    autosize();
    const reply = replyTo?.msgid;
    onCancelReply();
    const err = await execute({ app, buf, ui, replyTo: reply }, input);
    if (err) {
      toast(err, "error");
      text = input;
    }
  }

  function complete(backwards: boolean) {
    const pos = el.selectionStart;
    if (!completion) {
      const before = text.slice(0, pos);
      const m = /(\S*)$/.exec(before)!;
      const prefix = m[1];
      const start = pos - prefix.length;
      let options: string[];
      if (start === 0 && prefix.startsWith("/")) {
        options = completeCommand(prefix.slice(1)).map((c) => "/" + c + " ");
      } else if (buf.network.isChan(prefix)) {
        options = [...buf.network.buffers.values()]
          .filter((b) => b.type === "channel" && b.name.toLowerCase().startsWith(prefix.toLowerCase()))
          .map((b) => b.name + " ");
      } else {
        const lp = prefix.toLowerCase();
        // Most recent speakers first, then everyone else alphabetically.
        const recent: string[] = [];
        for (let i = buf.lines.length - 1; i >= 0 && recent.length < 50; i--) {
          const n = buf.lines[i].nick;
          if (n && !recent.includes(n)) recent.push(n);
        }
        const all = [...recent, ...buf.sortedMembers().map((m) => m.nick)];
        if (buf.type === "query") all.push(buf.name);
        const seen = new Set<string>();
        options = all
          .filter((n) => n.toLowerCase().startsWith(lp) && !buf.network.client.isMe(n))
          .filter((n) => (seen.has(n.toLowerCase()) ? false : (seen.add(n.toLowerCase()), true)))
          .map((n) => (start === 0 ? n + ": " : n + " "));
      }
      if (!options.length) return;
      completion = { prefix, start, options, idx: backwards ? options.length - 1 : 0 };
    } else {
      const n = completion.options.length;
      completion.idx = (completion.idx + (backwards ? n - 1 : 1)) % n;
    }
    const word = completion.options[completion.idx];
    const end = el.selectionStart;
    text = text.slice(0, completion.start) + word + text.slice(end);
    const caret = completion.start + word.length;
    tick().then(() => (el.selectionStart = el.selectionEnd = caret));
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && replyTo) {
      e.preventDefault();
      onCancelReply();
      return;
    }
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      complete(e.shiftKey);
      return;
    }
    if (e.key !== "Shift") completion = null;

    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === "ArrowUp" && !text.includes("\n") && sentHistory.length) {
      e.preventDefault();
      histIdx = histIdx < 0 ? sentHistory.length - 1 : Math.max(0, histIdx - 1);
      text = sentHistory[histIdx];
      return;
    }
    if (e.key === "ArrowDown" && histIdx >= 0 && !text.includes("\n")) {
      e.preventDefault();
      histIdx++;
      if (histIdx >= sentHistory.length) {
        histIdx = -1;
        text = "";
      } else text = sentHistory[histIdx];
      return;
    }
    // mIRC formatting shortcuts.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const codes: Record<string, string> = { b: "\x02", i: "\x1D", u: "\x1F" };
      const code = codes[e.key.toLowerCase()];
      if (code) {
        e.preventDefault();
        const s = el.selectionStart;
        const en = el.selectionEnd;
        if (s !== en) {
          text = text.slice(0, s) + code + text.slice(s, en) + code + text.slice(en);
        } else insert(code);
      }
    }
  }

  const placeholder = $derived(
    buf.type === "server"
      ? t("comp.serverPlaceholder", { network: buf.network.displayName })
      : buf.type === "channel" && !buf.joined
        ? t("comp.notJoined", { chan: buf.name })
        : t("comp.messageTo", { target: buf.name }),
  );
</script>

{#if replyTo}
  <div class="replying">
    <span>↪ {t("msg.replyingTo", { nick: replyTo.nick ?? "" })}:</span>
    <span class="snippet">{stripFormatting(replyTo.text)}</span>
    <button class="icon-btn" title={t("msg.cancelReply")} onclick={onCancelReply}>✕</button>
  </div>
{/if}
<div class="composer" class:with-reply={!!replyTo}>
  <span class="nick" title={t("comp.yourNick")}>{buf.network.nick}</span>
  <textarea
    bind:this={el}
    bind:value={text}
    rows="1"
    {placeholder}
    oninput={onInput}
    onkeydown={onKeydown}
    spellcheck="true"
    autocomplete="off"
    enterkeyhint="send"
    onpaste={onPaste}
  ></textarea>
  {#if canUpload}
    <button class="icon-btn attach" class:busy={uploading > 0} title={t("up.attach")} onclick={() => fileInput?.click()}>📎</button>
    <input
      bind:this={fileInput}
      type="file"
      multiple
      hidden
      onchange={() => {
        void upload([...(fileInput?.files ?? [])]);
        if (fileInput) fileInput.value = "";
      }}
    />
  {/if}
</div>

<style>
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    margin: 0 12px 12px;
    padding: 8px 12px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .replying {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 12px;
    padding: 4px 6px 4px 12px;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: 8px 8px 0 0;
    font-size: 0.85em;
    color: var(--fg-dim);
  }
  .replying .snippet {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .composer.with-reply {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
  .attach {
    align-self: center;
  }
  .attach.busy {
    animation: pulse 1s infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.3;
    }
  }
  .composer:focus-within {
    border-color: var(--accent);
  }
  .nick {
    color: var(--fg-dim);
    font-weight: 600;
    padding-bottom: 2px;
    white-space: nowrap;
  }
  textarea {
    flex: 1;
    resize: none;
    border: none;
    background: none;
    outline: none;
    padding: 0;
    line-height: 1.45;
    max-height: 200px;
  }
</style>
