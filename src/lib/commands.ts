// Slash commands typed in the composer.

import type { App, Buffer } from "./state.svelte";
import { settings, saveSettings } from "./settings.svelte";
import { t, type Key } from "./i18n.svelte";

export interface CommandContext {
  app: App;
  buf: Buffer;
  /** msgid of the message being replied to (+draft/reply). */
  replyTo?: string;
  /** Open UI panels (search, settings…). */
  ui: { openSearch(q?: string): void; openSettings(): void; openAddNetwork(): void };
}

type Handler = (ctx: CommandContext, args: string, argv: string[]) => void | Promise<void>;

interface Command {
  /** i18n key for the description, if not cmd.<name>.desc */
  descKey?: Key;
  descParams?: Record<string, string>;
  run: Handler;
}

export function usageOf(name: string): string {
  return t(`cmd.${name}.usage` as Key);
}

export function descriptionOf(name: string): string {
  const c = COMMANDS[name];
  return t(c?.descKey ?? (`cmd.${name}.desc` as Key), c?.descParams);
}

function requireArgs(argv: string[], n: number, name: string) {
  if (argv.length < n) throw new Error(t("cmd.usage", { usage: usageOf(name) }));
}

function sendText(ctx: CommandContext, target: string, text: string, command = "PRIVMSG") {
  const net = ctx.buf.network;
  const c = net.client;
  // Only the first line carries the reply tag.
  let replyTo = ctx.replyTo && net.canReply ? ctx.replyTo : undefined;
  for (const line of text.split("\n")) {
    if (!line) continue;
    for (const chunk of splitMessage(line, 400)) {
      const tags = replyTo ? { "+draft/reply": replyTo } : undefined;
      c.sendMsg({ tags, command, params: [target, chunk] });
      // Without echo-message we have to display our own message locally.
      if (!c.caps.has("echo-message")) {
        const buf = net.isChan(target) ? net.ensureBuffer(target) : net.ensureBuffer(target);
        const isAction = chunk.startsWith("\x01ACTION ");
        net.addLine(buf, {
          kind: isAction ? "action" : command === "NOTICE" ? "notice" : "privmsg",
          nick: c.nick,
          text: isAction ? chunk.slice(8, -1) : chunk,
          self: true,
          replyTo,
        });
      }
      replyTo = undefined;
    }
  }
}

/** Split a message on byte length, preferring whitespace boundaries. */
export function splitMessage(text: string, maxBytes: number): string[] {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= maxBytes) return [text];
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/(?<=\s)/)) {
    if (enc.encode(cur + word).length > maxBytes) {
      if (cur) out.push(cur.trimEnd());
      cur = "";
      // Hard-split very long words.
      let w = word;
      while (enc.encode(w).length > maxBytes) {
        let i = maxBytes;
        while (enc.encode(w.slice(0, i)).length > maxBytes) i--;
        out.push(w.slice(0, i));
        w = w.slice(i);
      }
      cur = w;
    } else cur += word;
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out;
}

export const COMMANDS: Record<string, Command> = {
  join: {
    run(ctx, _a, argv) {
      requireArgs(argv, 1, "join");
      const net = ctx.buf.network;
      let chan = argv[0];
      if (!net.isChan(chan)) chan = "#" + chan;
      ctx.app.pendingJoin = chan;
      net.client.send("JOIN", chan, ...(argv[1] ? [argv[1]] : []));
    },
  },
  part: {
    run(ctx, _a, argv) {
      const net = ctx.buf.network;
      let chan = ctx.buf.name;
      if (argv[0] && net.isChan(argv[0])) chan = argv.shift()!;
      net.client.send("PART", chan, ...(argv.length ? [argv.join(" ")] : []));
    },
  },
  close: {
    run(ctx) {
      const { buf, app } = ctx;
      if (buf.type === "server") throw new Error(t("cmd.cantCloseServer"));
      if (buf.type === "channel" && buf.joined) {
        app.closing.add(buf.key);
        buf.network.client.send("PART", buf.name);
      } else {
        buf.network.removeBuffer(buf);
      }
    },
  },
  msg: {
    run(ctx, _a, argv) {
      requireArgs(argv, 2, "msg");
      sendText(ctx, argv[0], argv.slice(1).join(" "));
    },
  },
  query: {
    run(ctx, _a, argv) {
      requireArgs(argv, 1, "query");
      const buf = ctx.buf.network.ensureBuffer(argv[0]);
      ctx.app.setActive(buf);
      if (argv.length > 1) sendText({ ...ctx, buf }, argv[0], argv.slice(1).join(" "));
    },
  },
  me: {
    run(ctx, args) {
      if (ctx.buf.type === "server") throw new Error(t("cmd.cantSendHere"));
      sendText(ctx, ctx.buf.name, `\x01ACTION ${args}\x01`);
    },
  },
  notice: {
    run(ctx, _a, argv) {
      requireArgs(argv, 2, "notice");
      sendText(ctx, argv[0], argv.slice(1).join(" "), "NOTICE");
    },
  },
  nick: {
    run(ctx, _a, argv) {
      requireArgs(argv, 1, "nick");
      ctx.buf.network.client.send("NICK", argv[0]);
    },
  },
  topic: {
    run(ctx, args) {
      if (ctx.buf.type !== "channel") throw new Error(t("cmd.channelsOnly"));
      if (args) ctx.buf.network.client.send("TOPIC", ctx.buf.name, args);
      else ctx.buf.network.info(ctx.buf, t("cmd.topic", { topic: ctx.buf.topic || t("cmd.noTopic") }));
    },
  },
  whois: {
    run(ctx, _a, argv) {
      requireArgs(argv, 1, "whois");
      ctx.buf.network.client.send("WHOIS", argv[0]);
    },
  },
  mode: {
    run(ctx, _a, argv) {
      const net = ctx.buf.network;
      if (!argv.length || (!net.isChan(argv[0]) && !net.client.isMe(argv[0]))) {
        argv.unshift(ctx.buf.type === "channel" ? ctx.buf.name : net.client.nick);
      }
      net.client.send("MODE", ...argv);
    },
  },
  op: modeShortcut("+o"),
  deop: modeShortcut("-o"),
  voice: modeShortcut("+v"),
  devoice: modeShortcut("-v"),
  kick: {
    run(ctx, _a, argv) {
      requireArgs(argv, 1, "kick");
      if (ctx.buf.type !== "channel") throw new Error(t("cmd.channelsOnly"));
      ctx.buf.network.client.send("KICK", ctx.buf.name, argv[0], ...(argv.length > 1 ? [argv.slice(1).join(" ")] : []));
    },
  },
  ban: {
    run(ctx, _a, argv) {
      requireArgs(argv, 1, "ban");
      if (ctx.buf.type !== "channel") throw new Error(t("cmd.channelsOnly"));
      const m = ctx.buf.members.get(ctx.buf.network.client.cm(argv[0]));
      const mask = m?.host ? `*!*@${m.host}` : argv[0].includes("!") ? argv[0] : `${argv[0]}!*@*`;
      ctx.buf.network.client.send("MODE", ctx.buf.name, "+b", mask);
    },
  },
  invite: {
    run(ctx, _a, argv) {
      requireArgs(argv, 1, "invite");
      ctx.buf.network.client.send("INVITE", argv[0], argv[1] ?? ctx.buf.name);
    },
  },
  away: {
    run(ctx, args) {
      for (const n of ctx.app.networks.values()) if (!n.isBouncer) n.client.send("AWAY", ...(args ? [args] : []));
    },
  },
  back: {
    run(ctx) {
      for (const n of ctx.app.networks.values()) if (!n.isBouncer) n.client.send("AWAY");
    },
  },
  quote: {
    run(ctx, args) {
      requireArgs(args ? [args] : [], 1, "quote");
      ctx.buf.network.client.sendRaw(args);
    },
  },
  raw: { run: (ctx, a, v) => COMMANDS.quote.run(ctx, a, v) },
  ctcp: {
    run(ctx, _a, argv) {
      requireArgs(argv, 2, "ctcp");
      const [nick, cmd, ...rest] = argv;
      ctx.buf.network.client.send("PRIVMSG", nick, `\x01${cmd.toUpperCase()}${rest.length ? " " + rest.join(" ") : ""}\x01`);
    },
  },
  list: {
    run(ctx, args) {
      ctx.buf.network.client.send("LIST", ...(args ? [args] : []));
    },
  },
  ignore: {
    run(ctx, _a, argv) {
      if (!argv.length) {
        ctx.buf.network.info(ctx.buf, t("cmd.ignoredList", { list: settings.ignored.join(", ") || t("cmd.none") }));
        return;
      }
      if (!settings.ignored.includes(argv[0])) settings.ignored.push(argv[0]);
      saveSettings();
      ctx.buf.network.info(ctx.buf, t("cmd.ignoring", { mask: argv[0] }));
    },
  },
  unignore: {
    run(ctx, _a, argv) {
      requireArgs(argv, 1, "unignore");
      settings.ignored = settings.ignored.filter((x) => x !== argv[0]);
      saveSettings();
      ctx.buf.network.info(ctx.buf, t("cmd.unignored", { mask: argv[0] }));
    },
  },
  search: {
    run(ctx, args) {
      ctx.ui.openSearch(args);
    },
  },
  bouncer: {
    run(ctx, args) {
      requireArgs(args ? [args] : [], 1, "bouncer");
      const net = ctx.app.bouncer ?? ctx.buf.network;
      net.client.send("PRIVMSG", "BouncerServ", args);
      ctx.app.setActive(net.ensureBuffer("BouncerServ"));
    },
  },
  network: {
    run(ctx) {
      ctx.ui.openAddNetwork();
    },
  },
  clear: {
    run(ctx) {
      ctx.buf.lines = [];
      ctx.buf.historyExhausted = false;
    },
  },
  settings: { run: (ctx) => ctx.ui.openSettings() },
  help: {
    run(ctx) {
      const lines = Object.keys(COMMANDS).map((name) => `${usageOf(name)} — ${descriptionOf(name)}`);
      ctx.buf.network.info(ctx.buf, t("cmd.available"));
      for (const l of lines) ctx.buf.network.info(ctx.buf, l);
    },
  },
};

function modeShortcut(mode: string): Command {
  const name = { "+o": "op", "-o": "deop", "+v": "voice", "-v": "devoice" }[mode]!;
  return {
    descKey: "cmd.modeShortcut.desc",
    descParams: { mode },
    run(ctx, _a, argv) {
      requireArgs(argv, 1, name);
      if (ctx.buf.type !== "channel") throw new Error(t("cmd.channelsOnly"));
      ctx.buf.network.client.send("MODE", ctx.buf.name, mode[0] + mode[1].repeat(argv.length), ...argv);
    },
  };
}

/** Execute composer input. Returns an error message, if any. */
export async function execute(ctx: CommandContext, input: string): Promise<string | null> {
  if (!input.trim()) return null;
  try {
    if (input.startsWith("/") && !input.startsWith("//")) {
      const sp = input.indexOf(" ");
      const name = (sp < 0 ? input.slice(1) : input.slice(1, sp)).toLowerCase();
      const args = sp < 0 ? "" : input.slice(sp + 1).trim();
      const argv = args ? args.split(/\s+/) : [];
      const cmd = COMMANDS[name];
      if (!cmd) {
        // Unknown command: send it raw, like most clients do.
        ctx.buf.network.client.sendRaw(input.slice(1));
        return null;
      }
      await cmd.run(ctx, args, argv);
      return null;
    }
    const text = input.startsWith("//") ? input.slice(1) : input;
    if (ctx.buf.type === "server") {
      return t("cmd.serverBuffer");
    }
    sendText(ctx, ctx.buf.name, text);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function completeCommand(prefix: string): string[] {
  return Object.keys(COMMANDS)
    .filter((c) => c.startsWith(prefix.toLowerCase()))
    .sort();
}
