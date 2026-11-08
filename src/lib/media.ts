// Detect which links can be shown inline.

export type MediaKind = "image" | "video" | "audio";

const EXT: [RegExp, MediaKind][] = [
  [/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i, "image"],
  [/\.(mp4|webm|mov|m4v|ogv)$/i, "video"],
  [/\.(mp3|ogg|oga|opus|m4a|wav|flac)$/i, "audio"],
];

/**
 * Media kind for a URL, from its path extension. Links without a known
 * extension are tried as images only when they come from a trusted origin
 * (e.g. the filehost our uploads go to).
 */
export function mediaKind(url: string, trustedOrigins: string[] = []): MediaKind | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  for (const [re, kind] of EXT) if (re.test(u.pathname)) return kind;
  if (trustedOrigins.includes(u.origin) && !/\.[a-z0-9]{1,5}$/i.test(u.pathname)) return "image";
  return null;
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏", "👀", "🔥", "✅", "➕", "👎"];
