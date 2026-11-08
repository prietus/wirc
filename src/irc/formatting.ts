// mIRC formatting codes → styled segments (rendered without innerHTML).

export interface Style {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  mono?: boolean;
  reverse?: boolean;
  fg?: string;
  bg?: string;
}

export interface Segment {
  text: string;
  style: Style;
  url?: string;
}

// The 99 standard mIRC colours.
export const MIRC_COLORS = [
  "#ffffff", "#000000", "#00007f", "#009300", "#ff0000", "#7f0000", "#9c009c", "#fc7f00",
  "#ffff00", "#00fc00", "#009393", "#00ffff", "#0000fc", "#ff00ff", "#7f7f7f", "#d2d2d2",
  "#470000", "#472100", "#474700", "#324700", "#004700", "#00472c", "#004747", "#002747",
  "#000047", "#2e0047", "#470047", "#47002a", "#740000", "#743a00", "#747400", "#517400",
  "#007400", "#007449", "#007474", "#004074", "#000074", "#4b0074", "#740074", "#740045",
  "#b50000", "#b56300", "#b5b500", "#7db500", "#00b500", "#00b571", "#00b5b5", "#0063b5",
  "#0000b5", "#7500b5", "#b500b5", "#b5006b", "#ff0000", "#ff8c00", "#ffff00", "#b2ff00",
  "#00ff00", "#00ffa0", "#00ffff", "#008cff", "#0000ff", "#a500ff", "#ff00ff", "#ff0098",
  "#ff5959", "#ffb459", "#ffff71", "#cfff60", "#6fff6f", "#65ffc9", "#6dffff", "#59b4ff",
  "#5959ff", "#c459ff", "#ff66ff", "#ff59bc", "#ff9c9c", "#ffd39c", "#ffff9c", "#e2ff9c",
  "#9cff9c", "#9cffdb", "#9cffff", "#9cd3ff", "#9c9cff", "#dc9cff", "#ff9cff", "#ff94d3",
  "#000000", "#131313", "#282828", "#363636", "#4d4d4d", "#656565", "#818181", "#9f9f9f",
  "#bcbcbc", "#e2e2e2", "#ffffff",
];

const URL_RE = /\b(?:https?:\/\/|www\.|ircs?:\/\/)[^\s<>"]+|\b(?:mailto:)[^\s<>"]+/gi;

function trimUrl(u: string): string {
  // Strip trailing punctuation, but keep balanced parentheses (Wikipedia links).
  while (/[.,;:!?'"\])}>]$/.test(u)) {
    if (u.endsWith(")") && (u.match(/\(/g)?.length ?? 0) >= (u.match(/\)/g)?.length ?? 0)) break;
    u = u.slice(0, -1);
  }
  return u;
}

export function stripFormatting(s: string): string {
  return s.replace(/\x03(\d{1,2}(,\d{1,2})?)?|\x04([0-9a-fA-F]{6}(,[0-9a-fA-F]{6})?)?|[\x02\x1D\x1F\x1E\x11\x16\x0F]/g, "");
}

export function parseFormatting(input: string): Segment[] {
  const out: Segment[] = [];
  let style: Style = {};
  let buf = "";
  const flush = () => {
    if (buf) out.push({ text: buf, style: { ...style } });
    buf = "";
  };

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    switch (c) {
      case "\x02": flush(); style.bold = !style.bold; break;
      case "\x1D": flush(); style.italic = !style.italic; break;
      case "\x1F": flush(); style.underline = !style.underline; break;
      case "\x1E": flush(); style.strike = !style.strike; break;
      case "\x11": flush(); style.mono = !style.mono; break;
      case "\x16": flush(); style.reverse = !style.reverse; break;
      case "\x0F": flush(); style = {}; break;
      case "\x03": {
        flush();
        const m = /^(\d{1,2})(?:,(\d{1,2}))?/.exec(input.slice(i + 1));
        if (!m) {
          delete style.fg;
          delete style.bg;
          break;
        }
        const fg = parseInt(m[1], 10);
        style.fg = fg === 99 ? undefined : MIRC_COLORS[fg];
        if (m[2] !== undefined) {
          const bg = parseInt(m[2], 10);
          style.bg = bg === 99 ? undefined : MIRC_COLORS[bg];
        }
        i += m[0].length;
        break;
      }
      case "\x04": {
        flush();
        const m = /^([0-9a-fA-F]{6})(?:,([0-9a-fA-F]{6}))?/.exec(input.slice(i + 1));
        if (!m) {
          delete style.fg;
          delete style.bg;
          break;
        }
        style.fg = "#" + m[1];
        if (m[2]) style.bg = "#" + m[2];
        i += m[0].length;
        break;
      }
      default:
        buf += c;
    }
  }
  flush();
  return linkify(out);
}

function linkify(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    let last = 0;
    URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(seg.text))) {
      const raw = trimUrl(m[0]);
      if (m.index > last) out.push({ text: seg.text.slice(last, m.index), style: seg.style });
      const href = raw.startsWith("www.") ? "https://" + raw : raw;
      out.push({ text: raw, style: seg.style, url: href });
      last = m.index + raw.length;
      URL_RE.lastIndex = last;
    }
    if (last < seg.text.length) out.push({ text: seg.text.slice(last), style: seg.style });
  }
  return out;
}

export function extractUrls(text: string): string[] {
  return parseFormatting(text)
    .filter((s) => s.url)
    .map((s) => s.url!);
}

/** Stable per-nick colour (HSL hue from a hash). */
export function nickColor(nick: string): string {
  let h = 0;
  const n = nick.toLowerCase().replace(/[_`|^]+$/, "");
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 65% var(--nick-lightness, 62%))`;
}
