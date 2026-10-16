import WebTorrent from "webtorrent";
import type { Torrent } from "webtorrent";

/**
 * Browser peers can only use WebSocket trackers (wss://), not udp://.
 * Included in created magnets so a pasted link can discover peers later.
 */
const BROWSER_TRACKERS = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.webtorrent.dev",
] as const;

let client: WebTorrent | null = null;
let activeTorrent: Torrent | null = null;

function getClient(): WebTorrent {
  if (!client) {
    client = new WebTorrent();
    client.on("error", (error) => {
      console.error("WebTorrent client error:", error);
    });
  }
  return client;
}

async function removeActiveTorrent(): Promise<void> {
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

/**
 * Create a torrent from a local File and return its magnet URI.
 * Starts seeding so the magnet stays useful for other clients later;
 * does not wire torrent bytes into the video element.
 */
export async function createMagnetFromFile(file: File): Promise<string> {
  await removeActiveTorrent();

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
        activeTorrent = seeded;
        resolve(seeded.magnetURI);
      },
    );

    torrent.once("error", (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

export async function clearSeededTorrent(): Promise<void> {
  await removeActiveTorrent();
}

export function destroyTorrentClient(): void {
  if (!client) {
    return;
  }

  const current = client;
  client = null;
  activeTorrent = null;
  current.destroy();
}
