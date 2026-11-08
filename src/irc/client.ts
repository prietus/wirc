// Low-level IRC-over-WebSocket client: registration, CAP negotiation, SASL,
// ISUPPORT, batches, labeled requests, keep-alive and reconnection.

import { t } from "../lib/i18n.svelte";
import { formatMessage, getCaseMapping, parseMessage, type CaseMapping, type IRCMessage } from "./message";

export const WANTED_CAPS = [
  "sasl",
  "message-tags",
  "server-time",
  "batch",
  "labeled-response",
  "echo-message",
  "multi-prefix",
  "away-notify",
  "account-notify",
  "account-tag",
  "extended-join",
  "chghost",
  "setname",
  "invite-notify",
  "cap-notify",
  "userhost-in-names",
  "draft/chathistory",
  "draft/event-playback",
  "draft/read-marker",
  "draft/extended-monitor",
  "draft/metadata-2",
  "soju.im/bouncer-networks",
  "soju.im/bouncer-networks-notify",
  "soju.im/search",
];

export type ConnState = "disconnected" | "connecting" | "registering" | "registered";

export interface ClientOptions {
  url: string;
  nick: string;
  username: string;
  password?: string;
  realname?: string;
  /** soju.im/bouncer-networks network ID to bind this connection to. */
  bouncerNetwork?: string;
  /** Auto-reconnect on unexpected disconnection. */
  reconnect?: boolean;
}

export interface Batch {
  ref: string;
  type: string;
  params: string[];
  tags: Record<string, string>;
  messages: IRCMessage[];
  parent?: string;
}

export interface RequestResult {
  messages: IRCMessage[];
  batch?: Batch;
}

type Events = {
  message: (msg: IRCMessage) => void;
  batch: (batch: Batch) => void;
  state: (state: ConnState) => void;
  error: (text: string) => void;
  raw: (line: string, outgoing: boolean) => void;
};

interface Pending {
  resolve: (r: RequestResult) => void;
  reject: (e: Error) => void;
  messages: IRCMessage[];
  timer: ReturnType<typeof setTimeout>;
}

const PING_INTERVAL = 60_000;
const PING_TIMEOUT = 30_000;
const REQUEST_TIMEOUT = 30_000;

export class IRCError extends Error {
  constructor(public msg: IRCMessage) {
    super(msg.params[msg.params.length - 1] ?? msg.command);
  }
}

export class Client {
  opts: ClientOptions;
  state: ConnState = "disconnected";
  nick: string;
  /** Capabilities advertised by the server (name → value). */
  availableCaps = new Map<string, string>();
  /** Capabilities currently enabled. */
  caps = new Set<string>();
  isupport = new Map<string, string>();
  cm: CaseMapping = getCaseMapping(undefined);

  private ws: WebSocket | null = null;
  private listeners: { [K in keyof Events]?: Set<Events[K]> } = {};
  private batches = new Map<string, Batch>();
  private pending = new Map<string, Pending>();
  private labelSeq = 0;
  private closedByUser = false;
  private fatal = false;
  private backoff = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivity = 0;
  private capLsDone = false;
  private saslInProgress = false;

  constructor(opts: ClientOptions) {
    this.opts = { reconnect: true, ...opts };
    this.nick = opts.nick;
  }

  on<K extends keyof Events>(ev: K, fn: Events[K]): () => void {
    const set = (this.listeners[ev] ??= new Set() as never) as Set<Events[K]>;
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit<K extends keyof Events>(ev: K, ...args: Parameters<Events[K]>) {
    const set = this.listeners[ev] as Set<(...a: Parameters<Events[K]>) => void> | undefined;
    set?.forEach((fn) => {
      try {
        fn(...args);
      } catch (e) {
        console.error(`wirc: error in ${ev} handler`, e);
      }
    });
  }

  private setState(s: ConnState) {
    if (this.state === s) return;
    this.state = s;
    this.emit("state", s);
  }

  connect() {
    this.closedByUser = false;
    this.fatal = false;
    this.cleanupSocket();
    this.setState("connecting");
    this.availableCaps.clear();
    this.caps.clear();
    this.isupport.clear();
    this.batches.clear();
    this.capLsDone = false;
    this.saslInProgress = false;
    this.nick = this.opts.nick;

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url, ["text.ircv3.net"]);
    } catch (e) {
      this.emit("error", t("err.badUrl", { url: this.opts.url }));
      this.setState("disconnected");
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.setState("registering");
      this.touch();
      this.rawSend({ command: "CAP", params: ["LS", "302"] });
      this.rawSend({ command: "NICK", params: [this.opts.nick] });
      this.rawSend({
        command: "USER",
        params: [this.opts.username, "0", "*", this.opts.realname || this.opts.nick],
      });
    };
    ws.onmessage = (ev) => {
      this.touch();
      const data = typeof ev.data === "string" ? ev.data : "";
      for (const line of data.split(/\r?\n/)) {
        if (!line) continue;
        this.emit("raw", line, false);
        this.handle(parseMessage(line));
      }
    };
    ws.onerror = () => {
      this.emit("error", t("err.ws"));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      this.rejectAllPending(new Error(t("err.closed")));
      this.setState("disconnected");
      if (!this.closedByUser && !this.fatal && this.opts.reconnect) this.scheduleReconnect();
    };
  }

  disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws && this.state === "registered") this.rawSend({ command: "QUIT", params: [] });
    this.cleanupSocket();
    this.setState("disconnected");
  }

  /** Reconnect immediately (e.g. when the browser comes back online). */
  reconnectNow() {
    if (this.closedByUser || this.state !== "disconnected") return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connect();
  }

  private cleanupSocket() {
    this.stopPing();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch {}
    }
    this.rejectAllPending(new Error(t("err.closed")));
  }

  /** Tear down the socket as if the server closed it (triggers reconnection). */
  private dropConnection() {
    this.cleanupSocket();
    this.setState("disconnected");
    if (!this.closedByUser && !this.fatal && this.opts.reconnect) this.scheduleReconnect();
  }

  private scheduleReconnect() {
    const delay = this.backoff * (0.75 + Math.random() * 0.5);
    this.backoff = Math.min(this.backoff * 2, 60_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private touch() {
    this.lastActivity = Date.now();
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastActivity < PING_INTERVAL || this.pongTimer) return;
      this.rawSend({ command: "PING", params: ["wirc"] });
      this.pongTimer = setTimeout(() => {
        this.emit("error", t("err.noResponse"));
        this.dropConnection();
      }, PING_TIMEOUT);
    }, 10_000);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = this.pongTimer = null;
  }

  private rejectAllPending(err: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private rawSend(msg: { tags?: Record<string, string | undefined>; command: string; params?: string[] }) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    const line = formatMessage(msg);
    this.emit("raw", line, true);
    this.ws.send(line);
    return true;
  }

  send(command: string, ...params: string[]) {
    return this.rawSend({ command, params });
  }

  sendMsg(msg: { tags?: Record<string, string | undefined>; command: string; params?: string[] }) {
    return this.rawSend(msg);
  }

  sendRaw(line: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.emit("raw", line, true);
    this.ws.send(line);
    return true;
  }

  get connected() {
    return this.state === "registered";
  }

  /**
   * Send a command and collect its whole response using labeled-response.
   * Resolves with every message (including nested batches) labelled for it.
   */
  request(command: string, params: string[], tags: Record<string, string> = {}): Promise<RequestResult> {
    if (!this.caps.has("labeled-response")) {
      return Promise.reject(new Error(t("err.noLabeled")));
    }
    const label = "w" + ++this.labelSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(label);
        reject(new Error(t("err.timeout", { cmd: command })));
      }, REQUEST_TIMEOUT);
      this.pending.set(label, { resolve, reject, messages: [], timer });
      if (!this.rawSend({ tags: { ...tags, label }, command, params })) {
        clearTimeout(timer);
        this.pending.delete(label);
        reject(new Error(t("err.notConnected")));
      }
    });
  }

  private settle(label: string, result: RequestResult, err?: IRCMessage) {
    const p = this.pending.get(label);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(label);
    if (err) p.reject(new IRCError(err));
    else p.resolve(result);
  }

  private handle(msg: IRCMessage) {
    // --- batches ----------------------------------------------------------
    if (msg.command === "BATCH") {
      const refTok = msg.params[0] ?? "";
      const ref = refTok.slice(1);
      if (refTok.startsWith("+")) {
        this.batches.set(ref, {
          ref,
          type: msg.params[1] ?? "",
          params: msg.params.slice(2),
          tags: msg.tags,
          messages: [],
          parent: msg.tags["batch"],
        });
      } else if (refTok.startsWith("-")) {
        const b = this.batches.get(ref);
        this.batches.delete(ref);
        if (!b) return;
        if (b.parent && this.batches.has(b.parent)) {
          // Nested: hoist messages into the parent, keep the inner batch info.
          const parent = this.batches.get(b.parent)!;
          parent.messages.push(...b.messages);
          if (!parent.tags["wirc-inner-type"]) {
            parent.tags["wirc-inner-type"] = b.type;
            parent.tags["wirc-inner-params"] = b.params.join(" ");
          }
          return;
        }
        const label = b.tags["label"];
        if (label && this.pending.has(label)) {
          const fail = b.messages.find((m) => m.command === "FAIL");
          this.settle(label, { messages: b.messages, batch: b }, fail);
          return;
        }
        this.emit("batch", b);
      }
      return;
    }
    const batchRef = msg.tags["batch"];
    if (batchRef && this.batches.has(batchRef)) {
      this.batches.get(batchRef)!.messages.push(msg);
      return;
    }

    // --- labeled single-message responses -------------------------------
    const label = msg.tags["label"];
    if (label && this.pending.has(label)) {
      const isErr = msg.command === "FAIL" || /^[45]\d\d$/.test(msg.command);
      this.settle(label, { messages: msg.command === "ACK" ? [] : [msg] }, isErr ? msg : undefined);
      if (msg.command === "ACK") return;
      if (msg.command === "FAIL") return;
    }

    switch (msg.command) {
      case "PING":
        this.rawSend({ command: "PONG", params: msg.params });
        return;
      case "PONG":
        return;
      case "CAP":
        this.handleCap(msg);
        this.emit("message", msg); // lets observers react to capability changes
        return;
      case "AUTHENTICATE":
        if (msg.params[0] === "+" && this.saslInProgress) {
          const user = this.opts.username;
          const payload = utf8ToBase64(`${user}\0${user}\0${this.opts.password ?? ""}`);
          // Split in 400-byte chunks per the SASL spec.
          for (let i = 0; i < payload.length; i += 400) {
            this.rawSend({ command: "AUTHENTICATE", params: [payload.slice(i, i + 400)] });
          }
          if (payload.length % 400 === 0) this.rawSend({ command: "AUTHENTICATE", params: ["+"] });
        }
        return;
      case "903": // RPL_SASLSUCCESS
        this.saslInProgress = false;
        this.finishCaps();
        break;
      case "902":
      case "904":
      case "905":
      case "906":
      case "908":
        if (this.saslInProgress) {
          this.saslInProgress = false;
          this.fatal = true;
          this.emit("error", t("err.authFailed", { reason: msg.params[msg.params.length - 1] }));
          this.cleanupSocket();
          this.setState("disconnected");
          return;
        }
        break;
      case "001":
        this.nick = msg.params[0];
        this.backoff = 1000;
        this.setState("registered");
        this.startPing();
        break;
      case "005":
        this.handleIsupport(msg.params.slice(1, -1));
        break;
      case "433": // ERR_NICKNAMEINUSE during registration
        if (this.state === "registering") {
          this.nick = this.nick + "_";
          this.rawSend({ command: "NICK", params: [this.nick] });
        }
        break;
      case "NICK":
        if (msg.prefix && this.cm(msg.prefix.name) === this.cm(this.nick)) this.nick = msg.params[0];
        break;
      case "ERROR":
        this.emit("error", msg.params[0] ?? "ERROR");
        if (this.state !== "registered") this.fatal = true;
        break;
    }
    this.emit("message", msg);
  }

  private handleCap(msg: IRCMessage) {
    const sub = (msg.params[1] ?? "").toUpperCase();
    const more = msg.params[2] === "*";
    const list = (more ? msg.params[3] : msg.params[2]) ?? "";
    const parse = () =>
      list
        .split(" ")
        .filter(Boolean)
        .map((tok) => {
          const i = tok.indexOf("=");
          return i < 0 ? ([tok, ""] as const) : ([tok.slice(0, i), tok.slice(i + 1)] as const);
        });

    switch (sub) {
      case "LS":
        for (const [k, v] of parse()) this.availableCaps.set(k, v);
        if (!more && !this.capLsDone) {
          this.capLsDone = true;
          this.requestCaps([...this.availableCaps.keys()]);
          if (!WANTED_CAPS.some((c) => this.availableCaps.has(c))) this.finishCaps();
        }
        break;
      case "NEW":
        for (const [k, v] of parse()) this.availableCaps.set(k, v);
        this.requestCaps(parse().map(([k]) => k));
        break;
      case "DEL":
        for (const [k] of parse()) {
          this.availableCaps.delete(k);
          this.caps.delete(k);
        }
        break;
      case "ACK":
        for (const [k] of parse()) {
          if (k.startsWith("-")) this.caps.delete(k.slice(1));
          else this.caps.add(k);
        }
        if (this.state === "registering" && !this.saslInProgress) {
          if (this.caps.has("sasl") && this.opts.password) {
            const mechs = this.availableCaps.get("sasl");
            if (mechs && !mechs.split(",").includes("PLAIN")) {
              this.fatal = true;
              this.emit("error", t("err.noSaslPlain"));
              this.cleanupSocket();
              return;
            }
            this.saslInProgress = true;
            this.rawSend({ command: "AUTHENTICATE", params: ["PLAIN"] });
          } else {
            this.finishCaps();
          }
        }
        break;
      case "NAK":
        if (this.state === "registering") this.finishCaps();
        break;
    }
  }

  private requestCaps(candidates: string[]) {
    const req = candidates.filter((c) => WANTED_CAPS.includes(c) && !this.caps.has(c));
    // soju only allows bouncer-networks-notify alongside bouncer-networks.
    if (req.length) this.rawSend({ command: "CAP", params: ["REQ", req.join(" ")] });
  }

  private finishCaps() {
    if (this.state !== "registering") return;
    if (this.opts.bouncerNetwork) {
      this.rawSend({ command: "BOUNCER", params: ["BIND", this.opts.bouncerNetwork] });
    }
    this.rawSend({ command: "CAP", params: ["END"] });
  }

  private handleIsupport(tokens: string[]) {
    for (const tok of tokens) {
      if (tok.startsWith("-")) {
        this.isupport.delete(tok.slice(1).toUpperCase());
        continue;
      }
      const i = tok.indexOf("=");
      const k = (i < 0 ? tok : tok.slice(0, i)).toUpperCase();
      const v = i < 0 ? "" : tok.slice(i + 1).replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      this.isupport.set(k, v);
    }
    this.cm = getCaseMapping(this.isupport.get("CASEMAPPING"));
  }

  // --- ISUPPORT helpers ---------------------------------------------------

  get chantypes(): string {
    return this.isupport.get("CHANTYPES") ?? "#&";
  }

  /** Membership prefixes, e.g. { modes: "qaohv", symbols: "~&@%+" }. */
  get prefixes(): { modes: string; symbols: string } {
    const m = /^\(([^)]*)\)(.*)$/.exec(this.isupport.get("PREFIX") ?? "(ov)@+");
    return m ? { modes: m[1], symbols: m[2] } : { modes: "ov", symbols: "@+" };
  }

  get chathistoryLimit(): number {
    const v = parseInt(this.isupport.get("CHATHISTORY") ?? "", 10);
    return v > 0 ? Math.min(v, 200) : 100;
  }

  isMe(nick: string) {
    return this.cm(nick) === this.cm(this.nick);
  }
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
