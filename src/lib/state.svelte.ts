// Application state: networks, buffers, messages, history, read markers.

import { SvelteMap } from "svelte/reactivity";
import { Client, type Batch, type ConnState } from "../irc/client";
import {
  formatAttrs,
  isChannel,
  parseAttrs,
  parseCTCP,
  type IRCMessage,
} from "../irc/message";
import { stripFormatting } from "../irc/formatting";
import { highlightMatchers, isIgnored, settings } from "./settings.svelte";
import { locale, t } from "./i18n.svelte";

export type LineKind =
  | "privmsg"
  | "notice"
  | "action"
  | "join"
  | "part"
  | "quit"
  | "nick"
  | "kick"
  | "mode"
  | "topic"
  | "invite"
  | "info"
  | "error";

export interface Line {
  id: number;
  ts: string; // ISO timestamp, as sent by the server (used for markers/history)
  time: Date;
  kind: LineKind;
  nick?: string;
  text: string;
  msgid?: string;
  self?: boolean;
  highlight?: boolean;
  account?: string;
  /** Target buffer name (used by search results). */
  target?: string;
  /** msgid this message replies to (+draft/reply). */
  replyTo?: string;
}

export interface Member {
  nick: string;
  prefix: string; // membership symbols, highest first, e.g. "@+"
  away?: boolean;
  account?: string;
  user?: string;
  host?: string;
}

export type BufferType = "server" | "channel" | "query";

/** emoji → nicks who reacted with it */
export type Reactions = Record<string, string[]>;

/** Per-target state synced through soju's draft/metadata-2 keys. */
export interface TargetMeta {
  pinned: boolean;
  muted: boolean;
  blocked: boolean;
}

export const REACT_TAGS = ["+draft/react", "+react"];
export const UNREACT_TAGS = ["+draft/unreact", "+unreact"];
export const REPLY_TAGS = ["+draft/reply", "+reply"];

function firstTag(tags: Record<string, string>, names: string[]): string | undefined {
  for (const n of names) if (tags[n] !== undefined && tags[n] !== "") return tags[n];
  return undefined;
}

/** If msg is a reaction TAGMSG, return its parts. */
export function parseReaction(msg: IRCMessage): { msgid: string; emoji: string; remove: boolean } | null {
  if (msg.command !== "TAGMSG") return null;
  const msgid = firstTag(msg.tags, REPLY_TAGS);
  if (!msgid) return null;
  const add = firstTag(msg.tags, REACT_TAGS);
  if (add) return { msgid, emoji: add, remove: false };
  const del = firstTag(msg.tags, UNREACT_TAGS);
  if (del) return { msgid, emoji: del, remove: true };
  return null;
}

const CHAT_KINDS = new Set<LineKind>(["privmsg", "notice", "action"]);
let lineSeq = 0;

export class Buffer {
  name = $state("");
  readonly type: BufferType;
  readonly network: Network;
  lines: Line[] = $state.raw([]);
  unread = $state(0);
  highlights = $state(0);
  topic = $state("");
  joined = $state(false);
  members = new SvelteMap<string, Member>();
  typing = new SvelteMap<string, number>();
  /** Timestamp of the last read message (from draft/read-marker, or local). */
  readMarker = $state<string | null>(null);
  historyExhausted = $state(false);
  historyLoading = $state(false);
  /** Remote user is online (MONITOR) / away — for queries. */
  away = $state(false);
  /** Reactions keyed by the msgid they react to. */
  reactions = new SvelteMap<string, Reactions>();

  constructor(network: Network, name: string, type: BufferType) {
    this.network = network;
    this.name = name;
    this.type = type;
  }

  get key() {
    return `${this.network.id}/${this.name}`;
  }

  get meta(): TargetMeta {
    return this.network.targetMeta.get(this.network.client.cm(this.name)) ?? { pinned: false, muted: false, blocked: false };
  }

  applyReaction(msgid: string, emoji: string, nick: string, remove: boolean) {
    const cur = this.reactions.get(msgid) ?? {};
    const nicks = (cur[emoji] ?? []).filter((n) => n.toLowerCase() !== nick.toLowerCase());
    if (!remove) nicks.push(nick);
    const next: Reactions = { ...cur };
    if (nicks.length) next[emoji] = nicks;
    else delete next[emoji];
    if (Object.keys(next).length) this.reactions.set(msgid, next);
    else this.reactions.delete(msgid);
  }

  get lastChatLine(): Line | undefined {
    for (let i = this.lines.length - 1; i >= 0; i--) if (CHAT_KINDS.has(this.lines[i].kind)) return this.lines[i];
    return undefined;
  }

  /** Merge lines (live or history), dedupe by msgid / content, keep sorted. */
  addLines(newLines: Line[]) {
    if (!newLines.length) return;
    const keyOf = (l: Line) => l.msgid ?? `${l.ts}|${l.kind}|${l.nick}|${l.text}`;
    const seen = new Set(this.lines.map(keyOf));
    const fresh = newLines.filter((l) => {
      const k = keyOf(l);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!fresh.length) return;
    let merged: Line[];
    const last = this.lines[this.lines.length - 1];
    if (!last || fresh.every((l) => l.ts >= last.ts)) {
      merged = this.lines.concat(fresh.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)));
    } else {
      merged = this.lines.concat(fresh);
      merged.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id - b.id));
    }
    const max = Math.max(200, settings.maxLines);
    if (merged.length > max) {
      // Trim from the side away from what's being looked at.
      merged = merged.slice(merged.length - max);
      this.historyExhausted = false;
    }
    this.lines = merged;
    this.recountUnread();
  }

  recountUnread() {
    const marker = this.readMarker;
    let unread = 0;
    let highlights = 0;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (marker && l.ts <= marker) break;
      if (!CHAT_KINDS.has(l.kind) || l.self) continue;
      unread++;
      if (l.highlight || (this.type === "query" && !this.meta.muted)) highlights++;
    }
    this.unread = unread;
    this.highlights = highlights;
  }

  setReadMarker(ts: string | null, fromServer = false) {
    if (ts && this.readMarker && ts <= this.readMarker) return;
    this.readMarker = ts;
    this.recountUnread();
    if (!fromServer && ts && this.network.client.caps.has("draft/read-marker") && this.type !== "server") {
      this.network.client.send("MARKREAD", this.name, "timestamp=" + ts);
    }
  }

  markAllRead() {
    const last = this.lines[this.lines.length - 1];
    if (last) this.setReadMarker(last.ts);
  }

  sortedMembers(): Member[] {
    const syms = this.network.client.prefixes.symbols;
    const rank = (m: Member) => (m.prefix ? syms.indexOf(m.prefix[0]) : syms.length);
    return [...this.members.values()].sort(
      (a, b) => rank(a) - rank(b) || a.nick.localeCompare(b.nick, undefined, { sensitivity: "base" }),
    );
  }
}

export interface NetworkCallbacks {
  onHighlight(buf: Buffer, line: Line): void;
  onError(net: Network, text: string): void;
}

export class Network {
  readonly id: string;
  name = $state("");
  state = $state<ConnState>("disconnected");
  nick = $state("");
  /** soju.im/bouncer-networks attributes (host, state, nickname…). */
  attrs = $state<Record<string, string>>({});
  buffers = new SvelteMap<string, Buffer>();
  /** Bumped whenever caps or ISUPPORT change (those live in plain Maps on the client). */
  rev = $state(0);
  /** soju.im/pinned, muted, blocked keyed by casemapped target. */
  targetMeta = new SvelteMap<string, TargetMeta>();
  readonly client: Client;
  readonly server: Buffer;
  private app: App;
  private namesPending = new Map<string, Member[]>();
  private everRegistered = false;

  constructor(app: App, id: string, client: Client, opts: { name?: string } = {}) {
    this.app = app;
    this.id = id;
    this.client = client;
    this.name = opts.name ?? id;
    this.server = new Buffer(this, opts.name ?? id, "server");
    client.on("state", (s) => {
      this.state = s;
      this.rev++;
      if (s === "registered") this.onRegistered();
      if (s === "disconnected") {
        for (const b of this.buffers.values()) b.joined = false;
        if (this.everRegistered) this.info(this.server, t("st.disconnected"));
      }
    });
    client.on("message", (m) => this.handle(m));
    client.on("batch", (b) => this.handleBatch(b));
    client.on("error", (t) => {
      this.addLine(this.server, { kind: "error", text: t });
      this.app.callbacks.onError(this, t);
    });
  }

  /** The unbound soju connection (only talks to BouncerServ / BOUNCER commands). */
  get isBouncer() {
    return this.id === "_main" && this.bouncerCaps;
  }
  bouncerCaps = $state(false);

  /** Network icon URL advertised via the draft/ICON ISUPPORT token. */
  get icon(): string | undefined {
    void this.rev;
    const v = this.client.isupport.get("DRAFT/ICON");
    return v && /^https?:\/\//i.test(v) ? v : undefined;
  }

  get displayName() {
    return this.attrs["name"] || this.client.isupport.get("NETWORK") || this.name;
  }

  isChan(name: string) {
    return isChannel(name, this.client.chantypes);
  }

  getBuffer(name: string): Buffer | undefined {
    if (name === "*" || name === "") return this.server;
    return this.buffers.get(this.client.cm(name));
  }

  ensureBuffer(name: string): Buffer {
    const existing = this.getBuffer(name);
    if (existing) return existing;
    const buf = new Buffer(this, name, this.isChan(name) ? "channel" : "query");
    this.buffers.set(this.client.cm(name), buf);
    if (buf.type === "query" && this.client.connected) {
      if (this.client.caps.has("draft/read-marker")) this.client.send("MARKREAD", name);
      void this.app.fetchHistory(buf, "latest");
    }
    return buf;
  }

  removeBuffer(buf: Buffer) {
    this.buffers.delete(this.client.cm(buf.name));
    if (this.app.active === buf) this.app.setActive(this.server);
  }

  sortedBuffers(): Buffer[] {
    return [...this.buffers.values()].sort((a, b) => {
      const pa = a.meta.pinned, pb = b.meta.pinned;
      if (pa !== pb) return pa ? -1 : 1;
      if (a.type !== b.type) return a.type === "channel" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }

  private makeLine(partial: Partial<Line> & { kind: LineKind; text: string }, msg?: IRCMessage): Line {
    const ts = msg?.tags["time"] ?? new Date().toISOString();
    return {
      id: ++lineSeq,
      ts,
      time: new Date(ts),
      msgid: msg?.tags["msgid"],
      account: msg?.tags["account"],
      replyTo: msg ? firstTag(msg.tags, REPLY_TAGS) : undefined,
      ...partial,
    };
  }

  addLine(buf: Buffer, partial: Partial<Line> & { kind: LineKind; text: string }, msg?: IRCMessage) {
    const line = this.makeLine(partial, msg);
    buf.addLines([line]);
    if (this.app.active === buf && this.app.focused && line.kind !== "error") buf.markAllRead();
    else if (
      CHAT_KINDS.has(line.kind) &&
      !line.self &&
      (line.highlight || (buf.type === "query" && !buf.meta.muted))
    ) {
      this.app.callbacks.onHighlight(buf, line);
    }
    return line;
  }

  /** Whether a client-only tag (e.g. "+draft/react") will reach the network (CLIENTTAGDENY). */
  canSendTag(tag: string): boolean {
    void this.rev;
    const c = this.client;
    if (!c.caps.has("message-tags") || this.isBouncer) return false;
    const deny = c.isupport.get("CLIENTTAGDENY");
    if (deny === undefined) return true;
    const name = tag.replace(/^\+/, "");
    let denied = false;
    for (const tok of deny.split(",")) {
      if (tok === "*") denied = true;
      else if (tok === "-" + name) return true;
      else if (tok === name) return false;
    }
    return !denied;
  }

  get canReact() {
    return this.canSendTag("+draft/react") && this.canSendTag("+draft/reply");
  }

  get canReply() {
    return this.canSendTag("+draft/reply");
  }

  sendReaction(buf: Buffer, msgid: string, emoji: string, remove = false) {
    const tags: Record<string, string> = { "+draft/reply": msgid };
    tags[remove ? "+draft/unreact" : "+draft/react"] = emoji;
    this.client.sendMsg({ tags, command: "TAGMSG", params: [buf.name] });
    if (!this.client.caps.has("echo-message")) buf.applyReaction(msgid, emoji, this.client.nick, remove);
  }

  get supportsTargetMeta() {
    void this.rev;
    return this.client.caps.has("draft/metadata-2") && !this.isBouncer;
  }

  setTargetMeta(buf: Buffer, key: keyof TargetMeta, value: boolean) {
    const k = this.client.cm(buf.name);
    const cur = this.targetMeta.get(k) ?? { pinned: false, muted: false, blocked: false };
    // Optimistic update; soju confirms with METADATA/761 or FAIL.
    this.targetMeta.set(k, { ...cur, [key]: value });
    if (this.supportsTargetMeta) {
      this.client.send("METADATA", buf.name, "SET", `soju.im/${key}`, value ? "1" : "0");
    }
  }

  isBlocked(nick: string) {
    return this.targetMeta.get(this.client.cm(nick))?.blocked ?? false;
  }

  private onTargetMeta(target: string, key: string, value: string | undefined) {
    const m = /^soju\.im\/(pinned|muted|blocked)$/.exec(key.toLowerCase());
    if (!m) return;
    const k = this.client.cm(target);
    const cur = this.targetMeta.get(k) ?? { pinned: false, muted: false, blocked: false };
    this.targetMeta.set(k, { ...cur, [m[1]]: value === "1" });
  }

  info(buf: Buffer, text: string, msg?: IRCMessage) {
    this.addLine(buf, { kind: "info", text }, msg);
  }

  private isHighlight(text: string, nick: string) {
    if (this.client.isMe(nick)) return false;
    const plain = stripFormatting(text);
    return highlightMatchers(this.client.nick).some((re) => re.test(plain));
  }

  // --- registration ------------------------------------------------------

  private async onRegistered() {
    this.nick = this.client.nick;
    this.bouncerCaps = this.client.caps.has("soju.im/bouncer-networks") && !this.client.opts.bouncerNetwork;
    const reconnect = this.everRegistered;
    this.everRegistered = true;
    this.info(this.server, reconnect ? t("st.reconnected") : t("st.connectedAs", { nick: this.client.nick }));
    if (this.isBouncer) return;

    if (this.client.caps.has("draft/metadata-2")) {
      this.client.send("METADATA", "*", "SUB", "soju.im/pinned", "soju.im/muted", "soju.im/blocked");
    }

    // Existing queries: resync history + read markers.
    for (const b of this.buffers.values()) {
      if (b.type !== "query") continue;
      if (this.client.caps.has("draft/read-marker")) this.client.send("MARKREAD", b.name);
      void this.app.fetchHistory(b, b.lines.length ? "after" : "latest");
    }
    // Discover conversations we're not aware of.
    if (this.client.caps.has("draft/chathistory")) {
      const to = new Date().toISOString();
      const fromDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
      try {
        const res = await this.client.request("CHATHISTORY", [
          "TARGETS",
          "timestamp=" + fromDate,
          "timestamp=" + to,
          "100",
        ]);
        for (const m of res.messages) {
          if (m.command !== "CHATHISTORY" || m.params[0] !== "TARGETS") continue;
          const name = m.params[1];
          if (!this.isChan(name) && !this.getBuffer(name)) this.ensureBuffer(name);
        }
      } catch (e) {
        console.warn("CHATHISTORY TARGETS failed", e);
      }
    }
  }

  // --- batches -----------------------------------------------------------

  private handleBatch(b: Batch) {
    // Unsolicited batches (netsplit/netjoin, etc.): handle messages individually.
    for (const m of b.messages) this.handle(m);
  }

  /** Convert a history message (from CHATHISTORY/SEARCH) into a line, without touching state. */
  historyLine(msg: IRCMessage, defaultTarget?: string): Line | null {
    const nick = msg.prefix?.name ?? "";
    const self = this.client.isMe(nick);
    switch (msg.command) {
      case "PRIVMSG":
      case "NOTICE": {
        const text = msg.params[1] ?? "";
        const ctcp = parseCTCP(text);
        if (ctcp && ctcp.command !== "ACTION") return null;
        const kind: LineKind = ctcp ? "action" : msg.command === "NOTICE" ? "notice" : "privmsg";
        const body = ctcp ? ctcp.param : text;
        const target = msg.params[0];
        return this.makeLine(
          {
            kind,
            nick,
            text: body,
            self,
            highlight: !self && this.isHighlight(body, nick),
            target: this.isChan(target) || self ? target : nick,
          },
          msg,
        );
      }
      case "JOIN":
        return this.makeLine({ kind: "join", nick, text: "", target: msg.params[0] }, msg);
      case "PART":
        return this.makeLine({ kind: "part", nick, text: msg.params[1] ?? "", target: msg.params[0] }, msg);
      case "QUIT":
        return this.makeLine({ kind: "quit", nick, text: msg.params[0] ?? "", target: defaultTarget }, msg);
      case "NICK":
        return this.makeLine({ kind: "nick", nick, text: msg.params[0], target: defaultTarget }, msg);
      case "KICK":
        return this.makeLine(
          { kind: "kick", nick, text: `${msg.params[1]}${msg.params[2] ? ` (${msg.params[2]})` : ""}`, target: msg.params[0] },
          msg,
        );
      case "TOPIC":
        return this.makeLine({ kind: "topic", nick, text: msg.params[1] ?? "", target: msg.params[0] }, msg);
      case "MODE":
        return this.makeLine({ kind: "mode", nick, text: msg.params.slice(1).join(" "), target: msg.params[0] }, msg);
      default:
        return null;
    }
  }

  // --- live message handling --------------------------------------------

  private handle(msg: IRCMessage) {
    if (msg.command === "005" || msg.command === "CAP") this.rev++;
    const c = this.client;
    const nick = msg.prefix?.name ?? "";
    const me = c.isMe(nick);

    switch (msg.command) {
      case "PRIVMSG":
      case "NOTICE":
        this.handlePrivmsg(msg);
        return;

      case "TAGMSG": {
        const target = msg.params[0];
        const reaction = parseReaction(msg);
        if (reaction) {
          if (isIgnored(nick, msg.prefix?.user, msg.prefix?.host) || this.isBlocked(nick)) return;
          const buf = this.isChan(target) ? this.getBuffer(target) : this.ensureBuffer(me ? target : nick);
          buf?.applyReaction(reaction.msgid, reaction.emoji, nick, reaction.remove);
          return;
        }
        const typing = msg.tags["+typing"];
        if (!typing || me) return;
        const buf = this.getBuffer(this.isChan(target) ? target : nick);
        if (!buf) return;
        if (typing === "active") buf.typing.set(nick, Date.now() + 6000);
        else if (typing === "paused") buf.typing.set(nick, Date.now() + 30000);
        else buf.typing.delete(nick);
        return;
      }

      case "JOIN": {
        const chan = msg.params[0];
        if (me) {
          const buf = this.ensureBuffer(chan);
          buf.joined = true;
          buf.members.clear();
          void this.app.fetchHistory(buf, buf.lines.length ? "after" : "latest");
          if (this.app.pendingJoin && c.cm(this.app.pendingJoin) === c.cm(chan)) {
            this.app.pendingJoin = null;
            this.app.setActive(buf);
          }
          return;
        }
        const buf = this.getBuffer(chan);
        if (!buf) return;
        buf.members.set(c.cm(nick), {
          nick,
          prefix: "",
          account: msg.params[1] && msg.params[1] !== "*" ? msg.params[1] : undefined,
          user: msg.prefix?.user,
          host: msg.prefix?.host,
        });
        if (!isIgnored(nick, msg.prefix?.user, msg.prefix?.host))
          this.addLine(buf, { kind: "join", nick, text: "" }, msg);
        return;
      }

      case "PART": {
        const buf = this.getBuffer(msg.params[0]);
        if (!buf) return;
        if (me) {
          buf.joined = false;
          buf.members.clear();
          if (this.app.closing.has(buf.key)) {
            this.app.closing.delete(buf.key);
            this.removeBuffer(buf);
            return;
          }
        } else buf.members.delete(c.cm(nick));
        this.addLine(buf, { kind: "part", nick, text: msg.params[1] ?? "", self: me }, msg);
        return;
      }

      case "KICK": {
        const buf = this.getBuffer(msg.params[0]);
        if (!buf) return;
        const victim = msg.params[1];
        if (c.isMe(victim)) {
          buf.joined = false;
          buf.members.clear();
        } else buf.members.delete(c.cm(victim));
        this.addLine(buf, { kind: "kick", nick, text: `${victim}${msg.params[2] ? ` (${msg.params[2]})` : ""}` }, msg);
        return;
      }

      case "QUIT": {
        const key = c.cm(nick);
        const ignored = isIgnored(nick, msg.prefix?.user, msg.prefix?.host);
        for (const buf of this.buffers.values()) {
          if (buf.members.has(key) || (buf.type === "query" && c.cm(buf.name) === key)) {
            buf.members.delete(key);
            if (!ignored) this.addLine(buf, { kind: "quit", nick, text: msg.params[0] ?? "" }, msg);
          }
        }
        return;
      }

      case "NICK": {
        const newNick = msg.params[0];
        const oldKey = c.cm(nick);
        const newKey = c.cm(newNick);
        if (me) this.nick = newNick;
        for (const buf of this.buffers.values()) {
          const m = buf.members.get(oldKey);
          if (m) {
            buf.members.delete(oldKey);
            buf.members.set(newKey, { ...m, nick: newNick });
            this.addLine(buf, { kind: "nick", nick, text: newNick, self: me }, msg);
          }
        }
        const q = this.buffers.get(oldKey);
        if (q && q.type === "query" && !this.buffers.has(newKey)) {
          this.buffers.delete(oldKey);
          q.name = newNick;
          this.buffers.set(newKey, q);
          this.addLine(q, { kind: "nick", nick, text: newNick }, msg);
        }
        if (me) this.info(this.server, t("st.nowKnownAs", { nick: newNick }), msg);
        return;
      }

      case "TOPIC": {
        const buf = this.getBuffer(msg.params[0]);
        if (!buf) return;
        buf.topic = msg.params[1] ?? "";
        this.addLine(buf, { kind: "topic", nick, text: buf.topic }, msg);
        return;
      }

      case "MODE": {
        const target = msg.params[0];
        if (!this.isChan(target)) {
          this.info(this.server, t("st.userMode", { modes: msg.params.slice(1).join(" ") }), msg);
          return;
        }
        const buf = this.getBuffer(target);
        if (!buf) return;
        this.applyChannelModes(buf, msg.params[1] ?? "", msg.params.slice(2));
        this.addLine(buf, { kind: "mode", nick: nick || this.displayName, text: msg.params.slice(1).join(" ") }, msg);
        return;
      }

      case "AWAY": {
        const key = c.cm(nick);
        const away = msg.params.length > 0;
        for (const buf of this.buffers.values()) {
          const m = buf.members.get(key);
          if (m) buf.members.set(key, { ...m, away });
          if (buf.type === "query" && c.cm(buf.name) === key) buf.away = away;
        }
        return;
      }

      case "ACCOUNT": {
        const key = c.cm(nick);
        const account = msg.params[0] === "*" ? undefined : msg.params[0];
        for (const buf of this.buffers.values()) {
          const m = buf.members.get(key);
          if (m) buf.members.set(key, { ...m, account });
        }
        return;
      }

      case "CHGHOST": {
        const key = c.cm(nick);
        for (const buf of this.buffers.values()) {
          const m = buf.members.get(key);
          if (m) buf.members.set(key, { ...m, user: msg.params[0], host: msg.params[1] });
        }
        return;
      }

      case "INVITE": {
        const target = this.app.active?.network === this ? this.app.active : this.server;
        this.addLine(target, { kind: "invite", nick, text: msg.params[1] }, msg);
        return;
      }

      case "METADATA": {
        // METADATA <target> <key> <visibility> [value]
        this.onTargetMeta(msg.params[0], msg.params[1] ?? "", msg.params[3]);
        return;
      }
      case "761": // RPL_KEYVALUE: <me> <target> <key> <visibility> <value>
        this.onTargetMeta(msg.params[1], msg.params[2] ?? "", msg.params[4]);
        return;
      case "762": // RPL_METADATAEND
      case "766": // ERR_KEYNOTSET
      case "770": // RPL_METADATASUBOK
      case "771": // RPL_METADATAUNSUBOK
      case "772": // RPL_METADATASUBS
      case "774": // RPL_METADATASYNCLATER
        return;

      case "MARKREAD": {
        const buf = this.getBuffer(msg.params[0]);
        const ts = msg.params[1]?.startsWith("timestamp=") ? msg.params[1].slice(10) : null;
        if (buf && ts) buf.setReadMarker(ts, true);
        return;
      }

      case "BOUNCER":
        this.app.handleBouncerCommand(this, msg);
        return;

      case "FAIL":
      case "WARN":
      case "NOTE": {
        const text = `${msg.params[0]} ${msg.params[1]}: ${msg.params[msg.params.length - 1]}`;
        this.addLine(this.activeOrServer(), { kind: msg.command === "NOTE" ? "info" : "error", text }, msg);
        return;
      }

      case "ERROR":
        return; // surfaced through the client "error" event

      // Numerics ---------------------------------------------------------
      case "332": {
        const buf = this.getBuffer(msg.params[1]);
        if (buf) buf.topic = msg.params[2] ?? "";
        return;
      }
      case "333":
        return;
      case "353": {
        const chan = msg.params[2];
        const list = this.namesPending.get(c.cm(chan)) ?? [];
        const syms = c.prefixes.symbols;
        for (const entry of (msg.params[3] ?? "").split(" ")) {
          if (!entry) continue;
          let i = 0;
          while (i < entry.length && syms.includes(entry[i])) i++;
          const rest = entry.slice(i);
          const bang = rest.indexOf("!");
          const at = rest.indexOf("@");
          list.push({
            nick: bang >= 0 ? rest.slice(0, bang) : rest,
            prefix: entry.slice(0, i),
            user: bang >= 0 ? rest.slice(bang + 1, at >= 0 ? at : undefined) : undefined,
            host: at >= 0 ? rest.slice(at + 1) : undefined,
          });
        }
        this.namesPending.set(c.cm(chan), list);
        return;
      }
      case "366": {
        const chan = msg.params[1];
        const list = this.namesPending.get(c.cm(chan));
        this.namesPending.delete(c.cm(chan));
        const buf = this.getBuffer(chan);
        if (!buf || !list) return;
        buf.members.clear();
        for (const m of list) buf.members.set(c.cm(m.nick), m);
        return;
      }
      case "301": // RPL_AWAY (in reply to a message)
        this.addLine(this.activeOrServer(), { kind: "info", text: t("st.isAway", { nick: msg.params[1], msg: msg.params[2] }) }, msg);
        return;
      case "311":
      case "312":
      case "313":
      case "317":
      case "318":
      case "319":
      case "320":
      case "330":
      case "338":
      case "378":
      case "671":
      case "276":
        this.addLine(this.activeOrServer(), { kind: "info", text: whoisText(msg) }, msg);
        return;
      case "005":
      case "376":
      case "422":
      case "PONG":
        return;
    }

    if (/^\d{3}$/.test(msg.command)) {
      const code = parseInt(msg.command, 10);
      const text = msg.params.slice(1).join(" ");
      if (code >= 400 && code < 600) {
        this.addLine(this.activeOrServer(), { kind: "error", text }, msg);
      } else {
        this.info(this.server, text, msg);
      }
    }
  }

  private activeOrServer(): Buffer {
    const a = this.app.active;
    return a && a.network === this ? a : this.server;
  }

  private handlePrivmsg(msg: IRCMessage) {
    const c = this.client;
    const nick = msg.prefix?.name ?? "";
    const me = c.isMe(nick);
    let target = msg.params[0] ?? "";
    let text = msg.params[1] ?? "";

    // STATUSMSG (e.g. "@#chan")
    const statusmsg = c.isupport.get("STATUSMSG") ?? "";
    if (target && statusmsg.includes(target[0]) && this.isChan(target.slice(1))) target = target.slice(1);

    const ctcp = parseCTCP(text);
    if (ctcp && ctcp.command !== "ACTION") {
      if (msg.command === "PRIVMSG" && !me) this.replyCTCP(nick, ctcp.command, ctcp.param);
      const buf = this.activeOrServer();
      this.info(buf, t(msg.command === "NOTICE" ? "st.ctcpReply" : "st.ctcp", { cmd: ctcp.command, nick, param: ctcp.param }), msg);
      return;
    }
    if (isIgnored(nick, msg.prefix?.user, msg.prefix?.host)) return;
    if (!me && !this.isChan(target) && this.isBlocked(nick)) return;

    const kind: LineKind = ctcp ? "action" : msg.command === "NOTICE" ? "notice" : "privmsg";
    if (ctcp) text = ctcp.param;

    let buf: Buffer;
    const fromServer = !msg.prefix || !msg.prefix.user || nick.includes(".") || c.state !== "registered";
    if (this.isChan(target)) {
      buf = this.getBuffer(target) ?? this.ensureBuffer(target);
    } else if (me) {
      buf = this.ensureBuffer(target);
    } else if (kind === "notice" && (fromServer || !this.getBuffer(nick))) {
      buf = fromServer ? this.server : this.activeOrServer();
    } else {
      buf = this.ensureBuffer(nick);
    }

    buf.typing.delete(nick);
    this.addLine(buf, { kind, nick, text, self: me, highlight: !me && this.isHighlight(text, nick) }, msg);
  }

  private replyCTCP(nick: string, command: string, param: string) {
    const reply = (s: string) => this.client.send("NOTICE", nick, `\x01${command} ${s}\x01`);
    switch (command) {
      case "VERSION":
        reply("wirc — web IRC client for soju");
        break;
      case "PING":
        reply(param);
        break;
      case "TIME":
        reply(new Date().toString());
        break;
      case "CLIENTINFO":
        reply("ACTION CLIENTINFO PING TIME VERSION");
        break;
    }
  }

  private applyChannelModes(buf: Buffer, modestr: string, args: string[]) {
    const c = this.client;
    const { modes: pmodes, symbols } = c.prefixes;
    const [a = "", b = "", cc = ""] = (c.isupport.get("CHANMODES") ?? "beI,k,l,imnpst").split(",");
    let adding = true;
    let ai = 0;
    for (const ch of modestr) {
      if (ch === "+") adding = true;
      else if (ch === "-") adding = false;
      else if (pmodes.includes(ch)) {
        const target = args[ai++];
        if (!target) continue;
        const key = c.cm(target);
        const m = buf.members.get(key);
        if (!m) continue;
        const sym = symbols[pmodes.indexOf(ch)];
        let prefix = m.prefix.replace(sym, "");
        if (adding) prefix += sym;
        prefix = [...prefix].sort((x, y) => symbols.indexOf(x) - symbols.indexOf(y)).join("");
        buf.members.set(key, { ...m, prefix });
      } else if (a.includes(ch) || b.includes(ch) || (cc.includes(ch) && adding)) {
        ai++;
      }
    }
  }
}

function whoisText(msg: IRCMessage): string {
  const p = msg.params;
  switch (msg.command) {
    case "311":
      return t("whois.user", { nick: p[1], user: p[2], host: p[3], real: p[5] });
    case "312":
      return t("whois.server", { nick: p[1], server: p[2], info: p[3] });
    case "317": {
      const idle = parseInt(p[2], 10);
      const signon = p[3]
        ? t("whois.signon", { date: new Date(parseInt(p[3], 10) * 1000).toLocaleString(locale()) })
        : "";
      return t("whois.idle", { nick: p[1], idle: formatDuration(idle) }) + signon;
    }
    case "318":
      return t("whois.end", { nick: p[1] });
    case "319":
      return t("whois.channels", { nick: p[1], channels: p[2] });
    case "330":
      return t("whois.account", { nick: p[1], account: p[2] });
    default:
      return p.slice(1).join(" ");
  }
}

function formatDuration(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s % 60}s`].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------

export interface LoginInfo {
  url: string;
  username: string;
  password: string;
  nick: string;
  realname?: string;
}

export class App {
  networks = new SvelteMap<string, Network>();
  active = $state<Buffer | null>(null);
  focused = $state(typeof document !== "undefined" ? document.hasFocus() : true);
  login = $state<LoginInfo | null>(null);
  bouncer = $state<Network | null>(null);
  /** Main connection status, for the login screen. */
  status = $state<"idle" | "connecting" | "ready" | "error">("idle");
  statusText = $state("");
  pendingJoin: string | null = null;
  /** Buffers whose PART was initiated by "close". */
  closing = new Set<string>();
  callbacks: NetworkCallbacks;

  constructor(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
  }

  get bouncerMode() {
    return !!this.bouncer;
  }

  allBuffers(): Buffer[] {
    const out: Buffer[] = [];
    for (const n of this.orderedNetworks()) out.push(n.server, ...n.sortedBuffers());
    return out;
  }

  orderedNetworks(): Network[] {
    const nets = [...this.networks.values()];
    return nets.sort((a, b) => {
      if (a.isBouncer !== b.isBouncer) return a.isBouncer ? 1 : -1;
      return a.displayName.localeCompare(b.displayName);
    });
  }

  setActive(buf: Buffer | null) {
    this.active = buf;
    if (buf) {
      try {
        localStorage.setItem("wirc.active", buf.key);
      } catch {}
      if (this.focused) buf.markAllRead();
    }
  }

  connect(info: LoginInfo) {
    this.disconnect();
    this.login = info;
    this.status = "connecting";
    this.statusText = "";
    try {
      this.restoreKey = localStorage.getItem("wirc.active");
    } catch {}
    const client = new Client({
      url: info.url,
      nick: info.nick,
      username: info.username,
      password: info.password,
      realname: info.realname,
    });
    // Created before connecting so it sees every message, including the MOTD.
    const main = new Network(this, "_main", client, { name: "IRC" });
    this.networks.set(main.id, main);
    this.watchRestore(main);

    client.on("state", (s) => {
      if (s !== "registered") return;
      this.status = "ready";
      if (main.isBouncer) {
        main.name = "soju";
        main.server.name = "soju";
        this.bouncer = main;
        void this.listBouncerNetworks();
      } else {
        main.name = client.isupport.get("NETWORK") ?? new URL(info.url, location.href).hostname;
        main.server.name = main.name;
        if (!this.active) this.setActive(main.server);
      }
    });
    client.on("error", (t) => {
      if (this.status !== "ready") {
        this.status = "error";
        this.statusText = t;
      }
    });
    client.connect();
  }

  disconnect() {
    for (const n of this.networks.values()) n.client.disconnect();
    this.networks.clear();
    this.bouncer = null;
    this.active = null;
    this.status = "idle";
  }

  logout() {
    this.disconnect();
    this.login = null;
    try {
      localStorage.removeItem("wirc.login");
      localStorage.removeItem("wirc.active");
    } catch {}
  }

  /** Buffer key to restore (from the previous session) once it appears. */
  restoreKey: string | null = null;

  private watchRestore(n: Network) {
    const check = (buf: Buffer | undefined) => {
      if (buf && this.restoreKey && buf.key === this.restoreKey) {
        this.restoreKey = null;
        this.setActive(buf);
      }
    };
    n.client.on("state", (s) => s === "registered" && check(n.server));
    n.client.on("message", (m) => {
      if (this.restoreKey && m.command === "JOIN") check(n.getBuffer(m.params[0]));
    });
  }

  // --- soju bouncer networks -------------------------------------------

  private async listBouncerNetworks() {
    const b = this.bouncer!;
    try {
      const res = await b.client.request("BOUNCER", ["LISTNETWORKS"]);
      for (const m of res.messages) if (m.command === "BOUNCER") this.handleBouncerCommand(b, m);
    } catch (e) {
      b.info(b.server, t("err.listNetworks", { err: (e as Error).message }));
    }
    if (!this.active) {
      const first = this.orderedNetworks().find((n) => !n.isBouncer);
      this.setActive(first ? first.server : b.server);
    }
  }

  handleBouncerCommand(net: Network, msg: IRCMessage) {
    if (msg.params[0] !== "NETWORK" || !net.isBouncer) return;
    const id = msg.params[1];
    const rawAttrs = msg.params[2] ?? "";
    const existing = this.networks.get(id);
    if (rawAttrs === "*") {
      if (existing) {
        existing.client.disconnect();
        if (this.active?.network === existing) this.setActive(net.server);
        this.networks.delete(id);
      }
      return;
    }
    const attrs = parseAttrs(rawAttrs);
    if (existing) {
      existing.attrs = { ...existing.attrs, ...attrs };
      if (attrs.name) existing.name = attrs.name;
      return;
    }
    const login = this.login!;
    const client = new Client({
      url: login.url,
      nick: attrs.nickname || login.nick,
      username: login.username,
      password: login.password,
      realname: login.realname,
      bouncerNetwork: id,
    });
    const n = new Network(this, id, client, { name: attrs.name || attrs.host || id });
    n.attrs = attrs;
    this.networks.set(id, n);
    this.watchRestore(n);
    client.connect();
  }

  async addBouncerNetwork(attrs: Record<string, string>) {
    if (!this.bouncer) throw new Error(t("err.noBouncer"));
    await this.bouncer.client.request("BOUNCER", ["ADDNETWORK", formatAttrs(attrs)]);
  }

  async changeBouncerNetwork(id: string, attrs: Record<string, string>) {
    if (!this.bouncer) throw new Error(t("err.noBouncer"));
    await this.bouncer.client.request("BOUNCER", ["CHANGENETWORK", id, formatAttrs(attrs)]);
  }

  async deleteBouncerNetwork(id: string) {
    if (!this.bouncer) throw new Error(t("err.noBouncer"));
    await this.bouncer.client.request("BOUNCER", ["DELNETWORK", id]);
  }

  // --- history -----------------------------------------------------------

  async fetchHistory(buf: Buffer, mode: "latest" | "before" | "after"): Promise<void> {
    const c = buf.network.client;
    if (!c.caps.has("draft/chathistory") || !c.caps.has("labeled-response") || buf.type === "server") return;
    if (buf.historyLoading) return;
    if (mode === "before" && buf.historyExhausted) return;
    const limit = String(c.chathistoryLimit);
    let params: string[];
    if (mode === "before") {
      const first = buf.lines[0];
      if (!first) return this.fetchHistory(buf, "latest");
      params = ["BEFORE", buf.name, "timestamp=" + first.ts, limit];
    } else if (mode === "after") {
      const last = buf.lines[buf.lines.length - 1];
      params = ["LATEST", buf.name, last ? "timestamp=" + last.ts : "*", limit];
    } else {
      params = ["LATEST", buf.name, "*", limit];
    }
    buf.historyLoading = true;
    try {
      const res = await c.request("CHATHISTORY", params);
      for (const m of res.messages) {
        const r = parseReaction(m);
        if (r && m.prefix && !isIgnored(m.prefix.name)) buf.applyReaction(r.msgid, r.emoji, m.prefix.name, r.remove);
      }
      const lines = res.messages
        .map((m) => buf.network.historyLine(m, buf.name))
        .filter((l): l is Line => !!l)
        .filter((l) => !l.nick || !isIgnored(l.nick));
      if (mode !== "after" && res.messages.length < parseInt(limit, 10)) buf.historyExhausted = true;
      buf.addLines(lines);
      if (this.active === buf && this.focused) buf.markAllRead();
    } catch (e) {
      console.warn("CHATHISTORY failed", buf.name, e);
    } finally {
      buf.historyLoading = false;
    }
  }

  // --- file uploads (soju.im/FILEHOST) ----------------------------------

  /** Upload endpoint advertised by soju, if any. */
  fileHost(net: Network): string | undefined {
    void net.rev;
    return net.client.isupport.get("SOJU.IM/FILEHOST") || undefined;
  }

  /**
   * Upload a file to soju's filehost and return its public URL.
   * Posts to the same-origin /uploads first (avoids CORS/http-origin issues,
   * since the ingress routes it to soju), falling back to the advertised URL.
   */
  async uploadFile(net: Network, file: File): Promise<string> {
    const filehost = this.fileHost(net);
    const login = this.login;
    if (!filehost || !login) throw new Error(t("err.noUpload"));
    const bytes = new TextEncoder().encode(`${login.username}:${login.password}`);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    const headers: Record<string, string> = {
      Authorization: "Basic " + btoa(bin),
      "Content-Type": file.type || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name || "file")}`,
    };
    const candidates = [new URL("/uploads", location.href).href];
    if (!candidates.includes(filehost)) candidates.push(filehost);
    let lastErr = "";
    for (const url of candidates) {
      let res: Response;
      try {
        res = await fetch(url, { method: "POST", headers, body: file, credentials: "omit" });
      } catch (e) {
        lastErr = (e as Error).message;
        continue;
      }
      if (res.status === 404 || res.status === 405) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      if (res.status === 413) {
        const limit = /maxsize=(\d+)/.exec(res.headers.get("Upload-Limit") ?? "")?.[1];
        throw new Error(t("err.uploadTooBig", { max: limit ? formatBytes(parseInt(limit, 10)) : "?" }));
      }
      if (!res.ok) throw new Error(t("err.uploadFailed", { err: (await res.text()).trim() || `HTTP ${res.status}` }));
      const loc = res.headers.get("Location");
      if (!loc) throw new Error(t("err.uploadFailed", { err: "no Location" }));
      return new URL(loc, filehost).href;
    }
    throw new Error(t("err.uploadFailed", { err: lastErr }));
  }

  // --- search (soju.im/search) -----------------------------------------

  async search(net: Network, text: string, opts: { in?: string; from?: string } = {}): Promise<Line[]> {
    const c = net.client;
    if (!c.caps.has("soju.im/search")) throw new Error(t("err.noSearch"));
    const attrs: Record<string, string> = { text, limit: "100" };
    if (opts.in) attrs.in = opts.in;
    if (opts.from) attrs.from = opts.from;
    const res = await c.request("SEARCH", [formatAttrs(attrs)]);
    return res.messages
      .map((m) => net.historyLine(m))
      .filter((l): l is Line => !!l)
      .reverse();
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
