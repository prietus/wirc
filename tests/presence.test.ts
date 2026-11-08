import { describe, expect, it } from "vitest";
import { filterPresence } from "../src/lib/settings.svelte";

const t = (min: number) => new Date(Date.UTC(2026, 0, 1, 12, min));
const L = (min: number, kind: string, nick: string) => ({ kind, nick, time: t(min) });

describe("filterPresence", () => {
  const lines = [
    L(0, "join", "lurker"), // never speaks → hidden
    L(1, "privmsg", "alice"),
    L(5, "part", "alice"), // spoke 4 min ago → shown
    L(6, "join", "bob"), // speaks 2 min later → shown
    L(8, "privmsg", "bob"),
    L(9, "privmsg", "carol"),
    L(30, "quit", "carol"), // spoke 21 min ago → hidden
    L(31, "nick", "dave"), // nick changes are never filtered
  ];

  it("show keeps everything", () => {
    expect(filterPresence(lines, "show")).toHaveLength(lines.length);
  });

  it("hide drops all joins/parts/quits", () => {
    expect(filterPresence(lines, "hide").map((l) => l.kind)).toEqual(["privmsg", "privmsg", "privmsg", "nick"]);
  });

  it("smart keeps only events from recent speakers", () => {
    const out = filterPresence(lines, "smart").map((l) => `${l.kind}:${l.nick}`);
    expect(out).toEqual([
      "privmsg:alice",
      "part:alice",
      "join:bob",
      "privmsg:bob",
      "privmsg:carol",
      "nick:dave",
    ]);
  });
});
