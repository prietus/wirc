// Global app instance + browser integration (notifications, focus, title).

import { App, type Buffer, type Line } from "./state.svelte";
import { settings } from "./settings.svelte";
import { stripFormatting } from "../irc/formatting";
import { t } from "./i18n.svelte";

export interface RuntimeConfig {
  server: { url: string; autoconnect: boolean };
  /** Where users can get the source code (AGPL §13). */
  source: string;
}

export const config: RuntimeConfig = $state({ server: { url: "", autoconnect: false }, source: "" });

export async function loadConfig() {
  try {
    const res = await fetch("config.json", { cache: "no-store" });
    if (res.ok) Object.assign(config, await res.json());
  } catch {}
}

export const toasts: { id: number; text: string; kind: "error" | "info" }[] = $state([]);
let toastSeq = 0;
export function toast(text: string, kind: "error" | "info" = "info") {
  const id = ++toastSeq;
  toasts.push({ id, text, kind });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, 6000);
}

function notify(buf: Buffer, line: Line) {
  if (!settings.notifications || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (buf.type === "query" && !settings.notifyAllQueries && !line.highlight) return;
  if (app.focused && app.active === buf) return;
  const title = buf.type === "channel" ? t("notif.in", { nick: line.nick ?? "", chan: buf.name }) : `${line.nick}`;
  const body = (line.kind === "action" ? `* ${line.nick} ` : "") + stripFormatting(line.text);
  try {
    const n = new Notification(title, { body, tag: buf.key, icon: "icon.svg" });
    n.onclick = () => {
      window.focus();
      app.setActive(buf);
      n.close();
    };
  } catch {}
}

export const app = new App({
  onHighlight: notify,
  onError: (net, text) => {
    if (!net.isBouncer) toast(`${net.displayName}: ${text}`, "error");
  },
});

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    app.focused = true;
    app.active?.markAllRead();
  });
  window.addEventListener("blur", () => (app.focused = false));
  window.addEventListener("online", () => {
    for (const n of app.networks.values()) n.client.reconnectNow();
  });

  // Unread count in the tab title.
  $effect.root(() => {
    $effect(() => {
      let hl = 0;
      for (const n of app.networks.values()) {
        hl += n.server.highlights;
        for (const b of n.buffers.values()) hl += b.highlights;
      }
      const name = app.active ? app.active.name : "wirc";
      document.title = (hl ? `(${hl}) ` : "") + name + (app.active ? " — wirc" : "");
    });
  });
}

// Debug handle in development builds only.
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __wirc: App }).__wirc = app;
