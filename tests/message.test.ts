import { describe, expect, it } from "vitest";
import { casemapRfc1459, formatMessage, parseMessage, parseTags, formatTags } from "../src/irc/message";
import { parseFormatting, stripFormatting } from "../src/irc/formatting";
import { splitMessage } from "../src/lib/commands";

describe("parseMessage", () => {
  it("parses tags, prefix, command and trailing", () => {
    const m = parseMessage("@time=2024-01-01T00:00:00.000Z;msgid=abc;+typing=active :nick!user@host PRIVMSG #chan :hello world");
    expect(m.tags).toEqual({ time: "2024-01-01T00:00:00.000Z", msgid: "abc", "+typing": "active" });
    expect(m.prefix).toEqual({ name: "nick", user: "user", host: "host" });
    expect(m.command).toBe("PRIVMSG");
    expect(m.params).toEqual(["#chan", "hello world"]);
  });

  it("unescapes tag values", () => {
    expect(parseTags("a=x\\sy\\:z\\\\;b;c=")).toEqual({ a: "x y;z\\", b: "", c: "" });
    // A lone trailing backslash is dropped.
    expect(parseTags("a=x\\")).toEqual({ a: "x" });
  });

  it("handles messages without prefix and empty trailing", () => {
    const m = parseMessage("TOPIC #chan :");
    expect(m.params).toEqual(["#chan", ""]);
  });

  it("round-trips through formatMessage", () => {
    const line = formatMessage({ tags: { label: "w1", x: "a b" }, command: "PRIVMSG", params: ["#c", ":) hi"] });
    expect(line).toBe("@label=w1;x=a\\sb PRIVMSG #c ::) hi");
    const m = parseMessage(line);
    expect(m.params).toEqual(["#c", ":) hi"]);
    expect(m.tags.x).toBe("a b");
  });

  it("formats soju attrs", () => {
    expect(formatTags({ host: "irc.libera.chat", name: "Libera Chat" })).toBe("host=irc.libera.chat;name=Libera\\sChat");
  });

  it("rfc1459 casemapping", () => {
    expect(casemapRfc1459("Nick[A]\\~")).toBe("nick{a}|^");
  });
});

describe("formatting", () => {
  it("parses colors and bold", () => {
    const segs = parseFormatting("\x02bold\x02 \x0304,01red\x03 plain");
    expect(segs.map((s) => s.text)).toEqual(["bold", " ", "red", " plain"]);
    expect(segs[0].style.bold).toBe(true);
    expect(segs[2].style.fg).toBe("#ff0000");
    expect(segs[2].style.bg).toBe("#000000");
    expect(segs[3].style.fg).toBeUndefined();
  });

  it("linkifies URLs without trailing punctuation", () => {
    const segs = parseFormatting("see https://example.com/a_(b). ok");
    const link = segs.find((s) => s.url);
    expect(link?.url).toBe("https://example.com/a_(b)");
  });

  it("strips formatting", () => {
    expect(stripFormatting("\x0312,04hi\x0F \x1Dthere")).toBe("hi there");
  });
});

describe("splitMessage", () => {
  it("splits long messages on word boundaries within byte limit", () => {
    const text = Array.from({ length: 100 }, (_, i) => `palabra${i}`).join(" ");
    const parts = splitMessage(text, 100);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(100);
    expect(parts.join(" ")).toBe(text);
  });
});
