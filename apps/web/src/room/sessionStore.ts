import {
  ResumeTokenSchema,
  RoomIdSchema,
  type ResumeToken,
  type RoomId,
} from "@swarmcue/protocol";

/** What this tab needs to reclaim its room session after a dropped connection or refresh. */
export type StoredSession = {
  roomId: RoomId;
  resumeToken: ResumeToken;
};

export type SessionStore = {
  load: () => StoredSession | null;
  save: (session: StoredSession) => void;
  clear: () => void;
};

export const SESSION_STORAGE_KEY = "swarmcue.session";
const FORMAT_VERSION = 1;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Keeps the room session in per-tab storage (sessionStorage in the browser).
 * Stored data is treated as untrusted: anything malformed is discarded.
 * Storage errors (e.g. storage disabled) are logged, and the app then simply
 * cannot resume after a refresh.
 */
export function createSessionStore(storage: StorageLike | null): SessionStore {
  function clear(): void {
    try {
      storage?.removeItem(SESSION_STORAGE_KEY);
    } catch (error) {
      console.error("Could not clear the stored room session:", error);
    }
  }

  return {
    load() {
      let raw: string | null;
      try {
        raw = storage?.getItem(SESSION_STORAGE_KEY) ?? null;
      } catch (error) {
        console.error("Could not read the stored room session:", error);
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
        !("resumeToken" in value)
      ) {
        clear();
        return null;
      }
      const roomId = RoomIdSchema.safeParse(value.roomId);
      const resumeToken = ResumeTokenSchema.safeParse(value.resumeToken);
      if (!roomId.success || !resumeToken.success) {
        clear();
        return null;
      }
      return { roomId: roomId.data, resumeToken: resumeToken.data };
    },

    save({ roomId, resumeToken }) {
      try {
        storage?.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify({ v: FORMAT_VERSION, roomId, resumeToken }),
        );
      } catch (error) {
        console.error("Could not store the room session:", error);
      }
    },

    clear,
  };
}

/** The tab's sessionStorage, or null where it is unavailable. */
export function browserSessionStorage(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
