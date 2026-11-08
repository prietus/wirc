<script lang="ts">
  import { parseFormatting, type Style } from "../irc/formatting";

  let { text, onNickClick }: { text: string; onNickClick?: (n: string) => void } = $props();

  const segments = $derived(parseFormatting(text));

  function css(s: Style): string {
    let fg = s.fg;
    let bg = s.bg;
    if (s.reverse) [fg, bg] = [bg ?? "var(--bg)", fg ?? "var(--fg)"];
    const parts: string[] = [];
    if (fg) parts.push(`color:${fg}`);
    if (bg) parts.push(`background:${bg}`);
    if (s.bold) parts.push("font-weight:700");
    if (s.italic) parts.push("font-style:italic");
    const deco = [s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ");
    if (deco) parts.push(`text-decoration:${deco}`);
    if (s.mono) parts.push("font-family:var(--mono)");
    return parts.join(";");
  }
</script>

{#each segments as seg, i (i)}{#if seg.url}<a href={seg.url} target="_blank" rel="noopener noreferrer" style={css(seg.style)}>{seg.text}</a>{:else}{@const st = css(seg.style)}{#if st}<span style={st}>{seg.text}</span>{:else}{seg.text}{/if}{/if}{/each}
