import WebTorrent from "webtorrent";
import type { Torrent } from "webtorrent";
import { pickVideoFile } from "../media/videoFile.js";

/**
 * Browser peers can only use WebSocket trackers (wss://), not udp://.
 * Included in created magnets so a pasted link can discover peers later.
 */
const BROWSER_TRACKERS = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.webtorrent.dev",
] as const;

/** Served from the site root by the Vite plugin in vite.config.ts. */
const SERVICE_WORKER_URL = "/webtorrent-sw.js";
const CONTROLLER_TIMEOUT_MS = 5000;
const STATS_INTERVAL_MS = 1000;

export type TorrentStats = {
  numPeers: number;
  /** 0 to 1. */
  progress: number;
  /** Bytes per second. */
  downloadSpeed: number;
};

export type MagnetPlayback = {
  fileName: string;
  streamUrl: string;
};

let client: WebTorrent | null = null;
let activeTorrent: Torrent | null = null;
let statsTimer: number | null = null;
let streamServerReady: Promise<void> | null = null;
/** Lets a newer seed/play call cancel an older one that is still awaiting. */
let operationId = 0;

function getClient(): WebTorrent {
  if (!client) {
    client = new WebTorrent();
    client.on("error", (error) => {
      console.error("WebTorrent client error:", error);
    });
  }
  return client;
}

function stopStats(): void {
  if (statsTimer !== null) {
    window.clearInterval(statsTimer);
    statsTimer = null;
  }
}

function startStats(
  torrent: Torrent,
  onStats: (stats: TorrentStats) => void,
): void {
  stopStats();
  const report = () => {
    onStats({
      numPeers: torrent.numPeers,
      progress: torrent.progress,
      downloadSpeed: torrent.downloadSpeed,
    });
  };
  report();
  statsTimer = window.setInterval(report, STATS_INTERVAL_MS);
}

async function removeActiveTorrent(): Promise<void> {
  stopStats();
  if (!client || !activeTorrent) {
    return;
  }

  const torrent = activeTorrent;
  activeTorrent = null;

  try {
    await client.remove(torrent);
  } catch (error) {
    console.error("Failed to remove previous torrent:", error);
  }
}

function supersededError(): Error {
  return new Error("Superseded by a newer torrent request.");
}

function waitForController(): Promise<void> {
  if (navigator.serviceWorker.controller) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onControllerChange = () => {
      window.clearTimeout(timer);
      resolve();
    };
    // A hard reload (Shift+Reload) bypasses service workers for that page load.
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      reject(
        new Error(
          "The streaming service worker is not controlling this page. Reload normally (not a hard reload) and try again.",
        ),
      );
    }, CONTROLLER_TIMEOUT_MS);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
      { once: true },
    );
  });
}

/**
 * Browser WebTorrent streams through a service worker: it intercepts
 * `/webtorrent/...` requests from the <video> element and asks this page's
 * client for the matching torrent pieces.
 */
function ensureStreamServer(torrentClient: WebTorrent): Promise<void> {
  if (!streamServerReady) {
    streamServerReady = (async () => {
      if (!("serviceWorker" in navigator)) {
        throw new Error(
          "This browser does not support service workers, which magnet playback requires.",
        );
      }
      await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
        scope: "/",
      });
      const registration = await navigator.serviceWorker.ready;
      await waitForController();
      torrentClient.createServer({ controller: registration }, "browser");
    })();
    streamServerReady.catch(() => {
      streamServerReady = null;
    });
  }
  return streamServerReady;
}

/**
 * Create a torrent from a local File and return its magnet URI.
 * Starts seeding so other clients can stream it; the local video element
 * keeps playing from the File directly.
 */
export async function createMagnetFromFile(file: File): Promise<string> {
  const id = ++operationId;
  await removeActiveTorrent();
  if (id !== operationId) {
    throw supersededError();
  }

  const torrentClient = getClient();

  return new Promise((resolve, reject) => {
    const torrent = torrentClient.seed(
      file,
      {
        // File.name is used as the torrent name when opts.name is omitted.
        announce: [...BROWSER_TRACKERS],
        createdBy: "SwarmCue",
      },
      (seeded) => {
        resolve(seeded.magnetURI);
      },
    );
    activeTorrent = torrent;

    torrent.once("error", (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/**
 * Join a torrent by magnet URI and resolve with a URL the <video> element
 * can stream from while pieces download.
 */
export async function playMagnet(
  magnetUri: string,
  onStats: (stats: TorrentStats) => void,
): Promise<MagnetPlayback> {
  const id = ++operationId;
  await removeActiveTorrent();
  const torrentClient = getClient();
  await ensureStreamServer(torrentClient);
  if (id !== operationId) {
    throw supersededError();
  }

  return new Promise((resolve, reject) => {
    const torrent = torrentClient.add(
      magnetUri,
      // Adds browser trackers in case the pasted magnet only lists udp:// ones.
      { announce: [...BROWSER_TRACKERS] },
      (ready) => {
        const file = pickVideoFile(ready.files);
        if (!file) {
          reject(new Error("This torrent has no browser-playable video file."));
          return;
        }
        resolve({ fileName: file.name, streamUrl: file.streamURL });
      },
    );
    activeTorrent = torrent;
    startStats(torrent, onStats);

    torrent.once("error", (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    torrent.once("close", () => {
      reject(new Error("Torrent was removed before it was ready."));
    });
  });
}

export async function clearActiveTorrent(): Promise<void> {
  operationId += 1;
  await removeActiveTorrent();
}

export function destroyTorrentClient(): void {
  operationId += 1;
  stopStats();
  if (!client) {
    return;
  }

  const current = client;
  client = null;
  activeTorrent = null;
  streamServerReady = null;
  current.destroy();
}
