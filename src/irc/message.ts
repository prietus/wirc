// IRC message parsing/serialization with IRCv3 message tags.

export interface Prefix {
  name: string;
  user?: string;
  host?: string;
}

export interface IRCMessage {
  tags: Record<string, string>;
  prefix?: Prefix;
  command: string;
  params: string[];
}

const TAG_UNESCAPE: Record<string, string> = { ":": ";", s: " ", "\\": "\\", r: "\r", n: "\n" };

export function unescapeTag(v: string): string {
  return v.replace(/\\(.?)/g, (_, c: string) => (c in TAG_UNESCAPE ? TAG_UNESCAPE[c] : c));
}

export function escapeTag(v: string): string {
  return v.replace(/[\\; \r\n]/g, (c) =>
    c === "\\" ? "\\\\" : c === ";" ? "\\:" : c === " " ? "\\s" : c === "\r" ? "\\r" : "\\n",
  );
}

export function parseTags(s: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const item of s.split(";")) {
    if (!item) continue;
    const i = item.indexOf("=");
    if (i < 0) tags[item] = "";
    else tags[item.slice(0, i)] = unescapeTag(item.slice(i + 1));
  }
  return tags;
}

export function formatTags(tags: Record<string, string | undefined>): string {
  return Object.entries(tags)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (v ? `${k}=${escapeTag(v)}` : k))
    .join(";");
}

export function parsePrefix(s: string): Prefix {
  const p: Prefix = { name: s };
  const at = s.indexOf("@");
  if (at >= 0) {
    p.host = s.slice(at + 1);
    s = s.slice(0, at);
  }
  const bang = s.indexOf("!");
  if (bang >= 0) {
    p.user = s.slice(bang + 1);
    s = s.slice(0, bang);
  }
  p.name = s;
  return p;
}

export function parseMessage(line: string): IRCMessage {
  let rest = line.replace(/[\r\n]+$/, "");
  let tags: Record<string, string> = {};
  let prefix: Prefix | undefined;

  if (rest.startsWith("@")) {
    const i = rest.indexOf(" ");
    tags = parseTags(rest.slice(1, i < 0 ? undefined : i));
    rest = i < 0 ? "" : rest.slice(i + 1).trimStart();
  }
  if (rest.startsWith(":")) {
    const i = rest.indexOf(" ");
    prefix = parsePrefix(rest.slice(1, i < 0 ? undefined : i));
    rest = i < 0 ? "" : rest.slice(i + 1).trimStart();
  }

  const params: string[] = [];
  let command = "";
  while (rest.length) {
    if (command && rest.startsWith(":")) {
      params.push(rest.slice(1));
      break;
    }
    const i = rest.indexOf(" ");
    const word = i < 0 ? rest : rest.slice(0, i);
    rest = i < 0 ? "" : rest.slice(i + 1).trimStart();
    if (!command) command = word.toUpperCase();
    else params.push(word);
  }
  return { tags, prefix, command, params };
}

export function formatMessage(msg: {
  tags?: Record<string, string | undefined>;
  command: string;
  params?: string[];
}): string {
  let s = "";
  const tags = msg.tags ? formatTags(msg.tags) : "";
  if (tags) s += "@" + tags + " ";
  s += msg.command;
  const params = msg.params ?? [];
  params.forEach((p, i) => {
    const last = i === params.length - 1;
    if (last && (p === "" || p.includes(" ") || p.startsWith(":"))) s += " :" + p;
    else s += " " + p;
  });
  return s;
}

/** Parse "key=value;key2=value2" attribute strings used by soju.im/bouncer-networks. */
export const parseAttrs = parseTags;
export const formatAttrs = formatTags;

// --- casemapping -----------------------------------------------------------

export type CaseMapping = (s: string) => string;

export const casemapAscii: CaseMapping = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

export const casemapRfc1459: CaseMapping = (s) =>
  s.replace(/[A-Z[\]\\~]/g, (c) =>
    c === "[" ? "{" : c === "]" ? "}" : c === "\\" ? "|" : c === "~" ? "^" : c.toLowerCase(),
  );

export function getCaseMapping(name: string | undefined): CaseMapping {
  return name === "ascii" ? casemapAscii : name === "rfc1459" || name === undefined ? casemapRfc1459 : casemapAscii;
}

// --- misc helpers ---------------------------------------------------------

export function isChannel(name: string, chantypes = "#&"): boolean {
  return name.length > 0 && chantypes.includes(name[0]);
}

export function messageTime(msg: IRCMessage): Date {
  const t = msg.tags["time"];
  return t ? new Date(t) : new Date();
}

export function isCTCP(text: string): boolean {
  return text.length > 1 && text.startsWith("\x01");
}

export function parseCTCP(text: string): { command: string; param: string } | null {
  if (!isCTCP(text)) return null;
  const inner = text.slice(1).replace(/\x01$/, "");
  const i = inner.indexOf(" ");
  return i < 0
    ? { command: inner.toUpperCase(), param: "" }
    : { command: inner.slice(0, i).toUpperCase(), param: inner.slice(i + 1) };
}
