import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// SOJU_URL: soju WebSocket listener to proxy /socket to during development,
// e.g. ws://localhost:8080 (kubectl port-forward) or wss://irc.example.com.
const target = process.env.SOJU_URL ?? "ws://localhost:8080";

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      "/uploads": {
        target: target.replace(/^ws/, "http"),
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => req.removeHeader("origin"));
        },
      },
      "/socket": {
        target,
        ws: true,
        changeOrigin: true,
        secure: false,
        // soju checks Origin against its Host (or `http-origin`); drop it so the
        // dev server at localhost:5173 is accepted without changing soju's config.
        configure: (proxy) => {
          proxy.on("proxyReqWs", (req) => req.removeHeader("origin"));
        },
      },
    },
  },
});
