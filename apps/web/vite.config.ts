import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Vite does not apply package "browser" field exclusions the same way Webpack
    // does; use WebTorrent's prebuilt browser bundle instead of the Node entry.
    alias: {
      webtorrent: fileURLToPath(
        new URL(
          "./node_modules/webtorrent/dist/webtorrent.min.js",
          import.meta.url,
        ),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/health": "http://localhost:3001",
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
