# wirc

A full-featured web IRC client for [soju](https://soju.im).

Lightweight soju web clients such as gamja keep things minimal. wirc aims for the
feature set of desktop clients (HexChat, WeeChat, irssi) while staying a static web app
that talks IRC directly to soju over WebSocket. It needs no backend of its own.

**English** and **Spanish** UI.

## Features

**Bouncer integration (soju)**
- Multiple networks through `soju.im/bouncer-networks`. You can add, edit and remove networks from the UI.
- Infinite scrollback and catch-up after reconnecting (`draft/chathistory`).
- Read markers synced across all your devices (`draft/read-marker`).
- Server-side history search (`soju.im/search`).
- File uploads through soju's filehost (`soju.im/FILEHOST`). Paste, drag and drop, or 📎.
- Pin, mute and block conversations, synced with your other soju clients (`draft/metadata-2`).

**Modern IRCv3**
- Threaded replies (`+draft/reply`), shown nested under the original message, with a notice when a reply lands off-screen.
- Reactions (`+draft/react`). soju stores them, so they survive reloads.
- Typing indicators (`+typing`), `echo-message`, `server-time`, `labeled-response`, `batch`, `away-notify`, `account-tag`, `extended-join`, `chghost`, `multi-prefix`, SASL PLAIN.
- Client-only tags are offered only when the upstream network accepts them (`CLIENTTAGDENY`).
  On networks without `message-tags` (e.g. Libera.Chat), reply and react buttons are hidden instead of failing silently.

**Client**
- Inline images, video and audio, with a full-screen viewer.
- Join/part/quit filtering per channel: show all, *smart* (only from people who spoke in the last 10 minutes), or hide.
- Highlight words with regex support. Ignore list with `nick!user@host` masks.
- Desktop notifications, unread and highlight counters, and an unread count in the tab title.
- Quick switcher (<kbd>Ctrl</kbd>+<kbd>K</kbd>), keyboard navigation, and tab completion of nicks, channels and commands.
- mIRC colors and formatting (<kbd>Ctrl</kbd>+<kbd>B</kbd>/<kbd>I</kbd>/<kbd>U</kbd>), and nick coloring.
- Around 30 `/commands` (`/help` lists them).
- Dark/light themes, compact mode, responsive layout for phones, and installable as a PWA.
- Theme editor (colors per light/dark mode, fonts, corner radius), custom CSS, and theme export/import.
- Network icons (`draft/ICON`).

## Requirements

- soju with a WebSocket listener. The client is tested against soju 0.11.
- `message-store db` is recommended. Search and stored reactions need it.

Minimal soju config:

```
listen irc+insecure://0.0.0.0:6667
listen http+insecure://0.0.0.0:8080   # WebSocket (/socket) and uploads (/uploads), TLS terminated by your proxy
hostname irc.example.com
db sqlite3 /data/soju.db
message-store db

# Optional: file uploads
http-ingress https://wirc.example.com
file-upload fs /data/uploads
```

Serve wirc and proxy `/socket` (and `/uploads`) to soju **on the same origin**.
soju's default origin check then accepts the connection, and you don't need to set `http-origin`.

## Running

### Docker

```sh
docker build -t wirc .
docker run -p 8080:8080 -e SOJU_UPSTREAM=soju-host:8080 wirc
```

Or `SOJU_UPSTREAM=soju-host:8080 docker compose up --build`.

| Variable          | Description                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `SOJU_UPSTREAM`   | `host:port` of soju's HTTP/WebSocket listener. If set, the bundled nginx proxies `/socket` and `/uploads` to it. |
| `WIRC_SERVER_URL` | Fixed WebSocket URL to connect to. Empty means same origin (`wss://<host>/socket`).               |
| `WIRC_SOURCE_URL` | Link to the source code, shown in the UI. If you run a modified version for others, the AGPL requires you to offer its source. |

### Kubernetes

`deploy/k8s/wirc.example.yaml` contains a Deployment, a Service and a Traefik IngressRoute.
The IngressRoute sends `/socket` and `/uploads` straight to an existing soju Service and everything else to wirc.

```sh
cp deploy/k8s/wirc.example.yaml deploy/k8s/wirc.yaml   # git-ignored: put your host and image here
kubectl apply -f deploy/k8s/wirc.yaml
```

### Static hosting

`npm run build` produces a static site in `dist/`. Serve it from any web server.
Edit `dist/config.json` to point to your soju:

```json
{ "server": { "url": "wss://irc.example.com/socket", "autoconnect": false } }
```

## Theming and custom CSS

Open Settings → **Customize colors, fonts & CSS…**. The dialog has three tabs:

- **Colors**: edit the theme you are currently viewing, dark or light. Each mode keeps its own overrides.
  Changed values are shown in bold, and ↺ restores the default.
- **Fonts**: interface font, monospace font and corner radius.
- **Custom CSS**: your own stylesheet, applied live on top of wirc's styles.

Everything is stored in your browser's `localStorage`. It is not synced between devices, because soju has no
storage for client preferences. Use **Export** and **Import** to move a theme between browsers or to share it.

### Theme variables

wirc's whole look is driven by CSS custom properties on `<html>`. The fastest way to restyle it is to change these,
either in the Colors tab or from custom CSS.

| Variable | Purpose | Dark | Light |
| --- | --- | --- | --- |
| `--bg` | Main background (messages) | `#16181d` | `#fafafa` |
| `--bg-2` | Panels: sidebar, nick list, input | `#1c1f26` | `#f0f1f4` |
| `--bg-3` | Raised / selected items | `#242833` | `#e5e7ec` |
| `--bg-hover` | Hover background | `#2a2f3b` | `#e1e4ea` |
| `--border` | Borders and separators | `#2c313c` | `#d9dce3` |
| `--fg` | Main text | `#d5d9e2` | `#1f2329` |
| `--fg-dim` | Secondary text | `#8a91a0` | `#5c6370` |
| `--fg-faint` | Faint text (timestamps, hints) | `#5d6472` | `#8b919c` |
| `--accent` | Links, focus, primary buttons | `#7aa2f7` | `#3466d6` |
| `--accent-fg` | Text on accent | `#0f1115` | `#ffffff` |
| `--hl-bg` | Background of highlighted messages | `rgba(247, 118, 142, 0.12)` | `rgba(214, 51, 82, 0.09)` |
| `--hl` | Highlights (mentions), badges | `#f7768e` | `#c4304d` |
| `--ok` | Connected / OK | `#9ece6a` | `#3f8a1c` |
| `--warn` | Notices, warnings | `#e0af68` | `#a86b00` |
| `--err` | Errors | `#f7768e` | `#c4304d` |
| `--nick-lightness` | Lightness of generated nick colors | `68%` | `40%` |
| `--radius` | Corner radius | `6px` | (same) |
| `--font` | Interface font | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | (same) |
| `--mono` | Monospace font (timestamps, code) | `ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace` | (same) |
| `--font-size` | Base font size (set from Settings) | `14px` | (same) |
| `--media-h`, `--media-w` | Max size of inline media (set from Settings) | `280px`, `420px` | (same) |

`--nick-lightness` controls the lightness of the colors generated for each nick (the hue comes from the nick).

### Stable selectors

These class names and attributes are part of wirc's public styling surface and won't change without a note in
the release. Anything else (internal class names, DOM structure) may change between versions.

| Selector | What it is |
| --- | --- |
| `:root[data-theme="dark"]` / `[data-theme="light"]` | Active theme (on `<html>`) |
| `.layout` | Main grid: sidebar + chat (`grid-template-columns`) |
| `.sidebar` | Buffer list column |
| `.net`, `.net-icon` | Network row, network icon (`draft/ICON`) |
| `.buf` | A buffer in the list. Modifiers: `.active`, `.unread`, `.muted`, `.parted` (channel you left) |
| `.view` | Chat area of the current buffer (header + messages + input) |
| `.view header`, `.topic` | Buffer header, topic |
| `.banner` | Connection warnings under the header |
| `.scroller` | Scrollable message list |
| `.sep.day`, `.sep.unread` | Day separator, "new messages" separator |
| `.line` | One message row. Modifiers: `.privmsg`, `.notice`, `.action`, `.join`, `.part`, `.quit`, `.nick`, `.kick`, `.mode`, `.topic`, `.invite`, `.info`, `.error`, `.highlight` (mentions you), `.self` (sent by you), `.cont` (continuation of the previous message) |
| `.line[data-nick="…"]` | Messages from a given nick (exact match, as sent by the server) |
| `.line[data-msgid="…"]` | A specific message |
| `.line > time`, `.line .nick`, `.line .text` | Timestamp, nick and text cells of a row |
| `.reply-ref` | "↪ an earlier message" shown on replies whose original isn't loaded |
| `.thread`, `.treply`, `.treply[data-nick="…"]` | Replies nested under a message |
| `.reactions`, `.chip`, `.chip.mine` | Reaction chips (`.mine` = you reacted) |
| `.media`, `.media img`, `.media video` | Inline media |
| `.typing` | "… is typing" line |
| `.pending` | "New reply in a thread" notice |
| `.composer`, `.replying` | Message input, "Replying to …" bar |
| `.members-col`, `.members`, `.member`, `.member.away` | Nick list column, list, entry, away users |
| `.lightbox` | Full-screen image viewer |
| `.modal` | Dialogs |
| `.toast`, `.toast.error` | Pop-up notifications |

### How rules are applied

- **Specificity.** wirc's component styles are scoped, so `.line { … }` is really `.line.svelte-xxxx` (two classes).
  Your custom CSS is loaded last, so it wins **when it is at least as specific**. A single-class rule loses:

  ```css
  .line { padding-left: 40px }                  /* ✗ ignored: less specific than wirc's own rule */
  .line { padding-left: 40px !important }       /* ✓ */
  .line[data-nick="zed"] { opacity: .5 }        /* ✓ class + attribute is specific enough */
  .line .text { font-family: var(--mono) }      /* ✓ property that wirc doesn't set on that element */
  ```

  When in doubt, add `!important`.
- **Variables.** Values set in the Colors and Fonts tabs are applied as inline styles on `<html>`, so they take
  precedence over variables you define in custom CSS. Use one or the other for a given variable, or reset it in the
  Colors tab.
- **Light and dark.** To change both modes from CSS, target both:
  `:root[data-theme="dark"], :root[data-theme="light"] { … }`. To change only one, use just that selector.

### Recipes

```css
/* Dim bots and services */
.line[data-nick="ChanServ"], .line[data-nick="NickServ"], .line[data-nick="mybot"] { opacity: .5 }

/* Hide inline images posted by someone */
.line[data-nick="spammer"] .media { display: none }

/* Wider nick column in messages */
.line { grid-template-columns: auto minmax(60px, 220px) 1fr !important }

/* Wider sidebar and nick list */
.layout { grid-template-columns: 260px minmax(0, 1fr) !important }
.members-col { width: 220px !important }

/* Monospace chat, like a terminal client */
.line .text, .treply { font-family: var(--mono) }

/* Hide timestamps but keep the alignment */
.line > time { visibility: hidden }

/* Louder mentions */
.line.highlight { background: #3b2a00 !important; box-shadow: inset 4px 0 0 gold !important }

/* Smaller thread replies */
.treply { font-size: 12px }

/* A palette for the dark mode only */
:root[data-theme="dark"] {
  --bg: #282a36; --bg-2: #21222c; --bg-3: #343746; --bg-hover: #3a3d4e; --border: #44475a;
  --fg: #f8f8f2; --fg-dim: #b6b9c8; --fg-faint: #6272a4;
  --accent: #bd93f9; --accent-fg: #1e1f29; --hl: #ff79c6; --hl-bg: rgba(255, 121, 198, .14);
  --ok: #50fa7b; --warn: #f1fa8c; --err: #ff5555;
}
```

### Theme files

**Export** produces a `wirc-theme.json` like this:

```json
{
  "wircTheme": 1,
  "dark": { "--accent": "#bd93f9" },
  "light": {},
  "common": { "--font": "Inter, sans-serif", "--radius": "4px" },
  "css": ".line[data-nick=\"mybot\"] { opacity: .5 }"
}
```

`dark` and `light` accept only the color variables listed above. `common` accepts `--font`, `--mono` and
`--radius`. Unknown keys are dropped on import. After an import the CSS tab opens, so you can see the CSS before
using it.

### Safety

Custom CSS can't run scripts, but it can load external resources (`url(…)`, `@import`). That reveals your IP
address to that server, and CSS can also be used to make the interface misleading. Only paste or import CSS you
trust. wirc never loads CSS or themes from the network on its own, for example from a channel or a link.

## Development

```sh
npm install
SOJU_URL=wss://irc.example.com npm run dev   # or ws://localhost:8080 via kubectl port-forward
npm test                                     # unit tests (vitest)
npm run check                                # type checking (svelte-check)
```

The dev server proxies `/socket` and `/uploads` to `SOJU_URL`.

Stack: Svelte 5, TypeScript and Vite. There are no runtime dependencies besides Svelte.

```
src/irc/          protocol: message parsing, IRC-over-WebSocket client, mIRC formatting
src/lib/          app state (networks, buffers, history, threads), commands, settings, i18n
src/components/   UI
tests/            unit tests
deploy/           Docker and Kubernetes
```

Translations live in `src/lib/i18n.svelte.ts`. Adding a language means adding one dictionary there.

## Privacy

- Your soju password is only sent to soju: over the WebSocket for SASL, and as HTTP Basic auth for uploads.
  If you tick "Remember on this browser", it is stored in that browser's `localStorage`.
- Inline media is loaded directly from the hosting site, which reveals your IP address to it.
  You can disable it in Settings.

## License

Copyright © 2026 teraflops

wirc is free software: you can redistribute it and/or modify it under the terms of the
[GNU Affero General Public License](LICENSE) as published by the Free Software Foundation,
either version 3 of the License, or (at your option) any later version.

wirc is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.
