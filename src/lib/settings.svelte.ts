// User preferences, persisted in localStorage.

export type JoinPartMode = "show" | "smart" | "hide";

export interface Settings {
  language: "en" | "es";
  theme: "dark" | "light" | "system";
  /** Default visibility of joins/parts/quits. */
  joinPartMode: JoinPartMode;
  /** Per-buffer overrides, keyed by Buffer.key. */
  bufferJoinPart: Record<string, JoinPartMode>;
  showSeconds: boolean;
  use12h: boolean;
  nickColors: boolean;
  /** Extra highlight words. Prefix with "/" for a regex, e.g. "/\\bdeploy(ed)?\\b". */
  highlightWords: string[];
  notifications: boolean;
  notifyAllQueries: boolean;
  sendTyping: boolean;
  showTyping: boolean;
  inlineMedia: boolean;
  mediaSize: "small" | "medium" | "large";
  /** Origins whose extension-less links are tried as images (learned from our uploads). */
  mediaOrigins: string[];
  showMemberList: boolean;
  compact: boolean;
  fontSize: number;
  maxLines: number;
  ignored: string[];
}

const DEFAULTS: Settings = {
  language: "en",
  theme: "system",
  joinPartMode: "smart",
  bufferJoinPart: {},
  showSeconds: false,
  use12h: false,
  nickColors: true,
  highlightWords: [],
  notifications: false,
  notifyAllQueries: true,
  sendTyping: true,
  showTyping: true,
  inlineMedia: true,
  mediaSize: "medium",
  mediaOrigins: [],
  showMemberList: true,
  compact: false,
  fontSize: 14,
  maxLines: 2000,
  ignored: [],
};

const KEY = "wirc.settings";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Migrate the old boolean setting.
      if (typeof saved.showJoinsParts === "boolean" && !saved.joinPartMode) {
        saved.joinPartMode = saved.showJoinsParts ? "show" : "hide";
      }
      delete saved.showJoinsParts;
      delete saved.imagePreviews;
      return { ...DEFAULTS, ...saved };
    }
  } catch {}
  return { ...DEFAULTS };
}

export const settings: Settings = $state(load());

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify($state.snapshot(settings)));
  } catch {}
}

export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  saveSettings();
}

/** Compile highlight words into matchers (cached by input). */
let cacheKey = "";
let cacheRes: RegExp[] = [];
export function highlightMatchers(nick: string): RegExp[] {
  const key = nick + "\0" + settings.highlightWords.join("\0");
  if (key === cacheKey) return cacheRes;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const res: RegExp[] = [new RegExp(`(^|[^\\w\\-\\[\\]\\\\\`^{}|])${esc(nick)}($|[^\\w\\-\\[\\]\\\\\`^{}|])`, "i")];
  for (const w of settings.highlightWords) {
    if (!w.trim()) continue;
    try {
      if (w.startsWith("/") && w.length > 1) {
        const m = /^\/(.*?)(?:\/([a-z]*))?$/.exec(w)!;
        res.push(new RegExp(m[1], m[2] ?? "i"));
      } else {
        res.push(new RegExp(`\\b${esc(w.trim())}\\b`, "i"));
      }
    } catch {}
  }
  cacheKey = key;
  cacheRes = res;
  return res;
}

/** Matches "nick", "nick!user@host" globs like "*!*@spam.example". */
export function isIgnored(nick: string, user = "", host = ""): boolean {
  if (!settings.ignored.length) return false;
  const full = `${nick}!${user}@${host}`.toLowerCase();
  return settings.ignored.some((pat) => {
    const p = pat.toLowerCase();
    const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return p.includes("!") || p.includes("@") ? re.test(full) : re.test(nick.toLowerCase());
  });
}

export function joinPartModeFor(key: string): JoinPartMode {
  return settings.bufferJoinPart[key] ?? settings.joinPartMode;
}

export function setJoinPartMode(key: string, mode: JoinPartMode | null) {
  if (mode === null || mode === settings.joinPartMode) delete settings.bufferJoinPart[key];
  else settings.bufferJoinPart[key] = mode;
  saveSettings();
}

const SMART_WINDOW = 10 * 60_000;
const PRESENCE = new Set(["join", "part", "quit"]);
const SPOKE = new Set(["privmsg", "notice", "action"]);

/**
 * Filter join/part/quit lines according to the mode. "smart" keeps them only
 * for nicks that spoke within SMART_WINDOW before the event (and keeps a join
 * if they speak within SMART_WINDOW after it).
 */
export function filterPresence<L extends { kind: string; nick?: string; time: Date }>(lines: L[], mode: JoinPartMode): L[] {
  if (mode === "show") return lines;
  if (mode === "hide") return lines.filter((l) => !PRESENCE.has(l.kind));
  const lastSpoke = new Map<string, number>();
  const keep = new Array<boolean>(lines.length).fill(true);
  const pendingJoin = new Map<string, number>(); // nick → index of unconfirmed join
  lines.forEach((l, i) => {
    const nick = l.nick?.toLowerCase() ?? "";
    const t = l.time.getTime();
    if (SPOKE.has(l.kind)) {
      lastSpoke.set(nick, t);
      const j = pendingJoin.get(nick);
      if (j !== undefined && t - lines[j].time.getTime() <= SMART_WINDOW) keep[j] = true;
      pendingJoin.delete(nick);
    } else if (PRESENCE.has(l.kind)) {
      const spoke = lastSpoke.get(nick);
      keep[i] = spoke !== undefined && t - spoke <= SMART_WINDOW;
      if (l.kind === "join" && !keep[i]) pendingJoin.set(nick, i);
    }
  });
  return lines.filter((_, i) => keep[i]);
}
