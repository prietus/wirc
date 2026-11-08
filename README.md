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
- mIRC colours and formatting (<kbd>Ctrl</kbd>+<kbd>B</kbd>/<kbd>I</kbd>/<kbd>U</kbd>), and nick colouring.
- Around 30 `/commands` (`/help` lists them).
- Dark/light themes, compact mode, responsive layout for phones, and installable as a PWA.

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
