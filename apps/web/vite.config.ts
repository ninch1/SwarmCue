import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const webtorrentDist = fileURLToPath(
  new URL("./node_modules/webtorrent/dist/", import.meta.url),
);

/**
 * WebTorrent's streaming service worker must be served from our own origin
 * at the site root so its scope covers `/webtorrent/...` stream URLs.
 * Served from the installed package so it always matches the library version.
 */
function webtorrentServiceWorker(): Plugin {
  const fileName = "webtorrent-sw.js";
  const readSource = () =>
    readFileSync(`${webtorrentDist}sw.min.js`, "utf8");

  return {
    name: "swarmcue-webtorrent-service-worker",
    configureServer(server) {
      server.middlewares.use(`/${fileName}`, (_req, res) => {
        res.setHeader("Content-Type", "text/javascript");
        res.end(readSource());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName, source: readSource() });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), webtorrentServiceWorker()],
  resolve: {
    // Vite does not apply package "browser" field exclusions the same way Webpack
    // does; use WebTorrent's prebuilt browser bundle instead of the Node entry.
    alias: {
      webtorrent: `${webtorrentDist}webtorrent.min.js`,
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
