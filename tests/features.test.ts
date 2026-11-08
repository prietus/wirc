import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/irc/message";
import { parseReaction } from "../src/lib/state.svelte";
import { mediaKind } from "../src/lib/media";

describe("parseReaction", () => {
  it("parses draft and final tag names", () => {
    expect(parseReaction(parseMessage("@+draft/react=👍;+draft/reply=abc :n!u@h TAGMSG #c"))).toEqual({
      msgid: "abc",
      emoji: "👍",
      remove: false,
    });
    expect(parseReaction(parseMessage("@+unreact=🎉;+reply=x1 :n!u@h TAGMSG #c"))).toEqual({
      msgid: "x1",
      emoji: "🎉",
      remove: true,
    });
  });

  it("ignores non-reaction messages", () => {
    expect(parseReaction(parseMessage("@+typing=active :n!u@h TAGMSG #c"))).toBeNull();
    expect(parseReaction(parseMessage("@+draft/react=👍 :n!u@h TAGMSG #c"))).toBeNull(); // no target msgid
    expect(parseReaction(parseMessage("@+draft/reply=abc :n!u@h PRIVMSG #c :hola"))).toBeNull();
  });
});

describe("mediaKind", () => {
  it("detects by extension, ignoring query strings", () => {
    expect(mediaKind("https://x.org/a/cat.JPG?w=200")).toBe("image");
    expect(mediaKind("https://x.org/v.webm")).toBe("video");
    expect(mediaKind("https://x.org/song.opus")).toBe("audio");
    expect(mediaKind("https://x.org/page.html")).toBeNull();
    expect(mediaKind("https://x.org/abc123")).toBeNull();
  });

  it("tries extension-less links from trusted origins as images", () => {
    expect(mediaKind("https://paste.example.com/abc123", ["https://paste.example.com"])).toBe("image");
    expect(mediaKind("https://paste.example.com/notes.txt", ["https://paste.example.com"])).toBeNull();
  });

  it("rejects non-http schemes", () => {
    expect(mediaKind("javascript:alert(1)//.png")).toBeNull();
    expect(mediaKind("data:image/png;base64,AAAA")).toBeNull();
  });
});
