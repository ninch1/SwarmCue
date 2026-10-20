/**
 * WebTorrent's browser store (fsa-chunk-store) writes each torrent into the
 * Origin Private File System as a folder named `<torrent name> - <infoHash[0..8]>`.
 * Torrents are created with `destroyStoreOnDestroy`, so switching media deletes
 * that folder; this sweep removes folders left behind when a tab was refreshed
 * or closed before the async delete could finish.
 */

const TAB_LOCK_NAME = "swarmcue:torrent-storage";
const STORE_DIR_PATTERN = / - [0-9a-f]{8}$/;

let storageReady: Promise<void> | null = null;

export function isTorrentStoreDirName(name: string): boolean {
  return STORE_DIR_PATTERN.test(name);
}

/**
 * Resolves once this tab may safely write torrent data. Never rejects;
 * cleanup failures are logged and leave leftovers for a later sweep.
 */
export function prepareTorrentStorage(): Promise<void> {
  storageReady ??= setUpStorage();
  return storageReady;
}

async function setUpStorage(): Promise<void> {
  if (
    !("locks" in navigator) ||
    typeof navigator.storage?.getDirectory !== "function"
  ) {
    // Without cross-tab coordination a sweep could delete another tab's
    // active torrent, so skip it.
    return;
  }

  try {
    // OPFS is shared by every tab of this origin. Only sweep when no other
    // SwarmCue tab holds the shared lock, i.e. nothing else is using the data.
    await navigator.locks.request(
      TAB_LOCK_NAME,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (lock) {
          await sweepTorrentStores();
        }
      },
    );
  } catch (error) {
    console.error("Failed to clear leftover torrent data:", error);
  }

  await holdSharedLockForTabLifetime();
}

function holdSharedLockForTabLifetime(): Promise<void> {
  return new Promise((resolve) => {
    navigator.locks
      .request(TAB_LOCK_NAME, { mode: "shared" }, () => {
        resolve();
        // Never settles, so the lock is released only when the tab goes away.
        return new Promise<never>(() => {});
      })
      .catch((error: unknown) => {
        console.error("Failed to acquire torrent storage lock:", error);
        resolve();
      });
  });
}

async function sweepTorrentStores(): Promise<void> {
  const root = await navigator.storage.getDirectory();

  const names: string[] = [];
  for await (const name of root.keys()) {
    if (isTorrentStoreDirName(name)) {
      names.push(name);
    }
  }

  for (const name of names) {
    try {
      await root.removeEntry(name, { recursive: true });
    } catch (error) {
      console.error(`Failed to remove torrent data "${name}":`, error);
    }
  }
}
