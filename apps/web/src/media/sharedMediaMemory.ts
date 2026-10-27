import { RoomIdSchema, type RoomId } from "@swarmcue/protocol";

/** Which media this tab shared, so a refreshed host can be asked to re-pick the file. */
export type SharedMediaMemory = {
  roomId: RoomId;
  /** Lowercased info hash of the torrent this tab seeded. */
  infoHash: string;
};

export type SharedMediaMemoryStore = {
  load: () => SharedMediaMemory | null;
  save: (memory: SharedMediaMemory) => void;
  clear: () => void;
};

export const SHARED_MEDIA_STORAGE_KEY = "swarmcue.sharedMedia";
const FORMAT_VERSION = 1;
const INFO_HASH = /^(?:[0-9a-f]{40}|[a-z2-7]{32})$/;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Per-tab record (sessionStorage in the browser) of the media this tab
 * shared. Stored data is untrusted and discarded when malformed; storage
 * errors are logged and only cost the re-pick prompt.
 */
export function createSharedMediaMemory(storage: StorageLike | null): SharedMediaMemoryStore {
  function clear(): void {
    try {
      storage?.removeItem(SHARED_MEDIA_STORAGE_KEY);
    } catch (error) {
      console.error("Could not clear the shared media record:", error);
    }
  }

  return {
    load() {
      let raw: string | null;
      try {
        raw = storage?.getItem(SHARED_MEDIA_STORAGE_KEY) ?? null;
      } catch (error) {
        console.error("Could not read the shared media record:", error);
        return null;
      }
      if (raw === null) {
        return null;
      }
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        clear();
        return null;
      }
      if (
        typeof value !== "object" ||
        value === null ||
        Object.keys(value).length !== 3 ||
        !("v" in value) ||
        value.v !== FORMAT_VERSION ||
        !("roomId" in value) ||
        !("infoHash" in value) ||
        typeof value.infoHash !== "string" ||
        !INFO_HASH.test(value.infoHash)
      ) {
        clear();
        return null;
      }
      const roomId = RoomIdSchema.safeParse(value.roomId);
      if (!roomId.success) {
        clear();
        return null;
      }
      return { roomId: roomId.data, infoHash: value.infoHash };
    },

    save({ roomId, infoHash }) {
      try {
        storage?.setItem(
          SHARED_MEDIA_STORAGE_KEY,
          JSON.stringify({ v: FORMAT_VERSION, roomId, infoHash }),
        );
      } catch (error) {
        console.error("Could not store the shared media record:", error);
      }
    },

    clear,
  };
}
