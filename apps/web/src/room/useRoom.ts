import type { PlaybackStatus, SharedMedia } from "@swarmcue/protocol";
import { useEffect, useRef, useState } from "react";
import { startClockSync } from "../clock/clockSync.js";
import { openRoomConnection } from "./connection.js";
import { createRoomSession, type RoomSession, type RoomState } from "./roomSession.js";
import { browserSessionStorage, createSessionStore } from "./sessionStore.js";

export type { RoomState } from "./roomSession.js";

export type UseRoom = {
  state: RoomState;
  createRoom: (displayName: string) => void;
  joinRoom: (roomCode: string, displayName: string) => void;
  leaveRoom: () => void;
  /**
   * Host only: share media with the room. Returns a validation message when
   * the media cannot be sent, otherwise null.
   */
  setMedia: (media: SharedMedia) => string | null;
  /**
   * Any participant: play, pause, or seek the room's media, reporting this
   * client's current position. Returns a message when the command cannot be
   * sent, otherwise null.
   */
  setPlayback: (status: PlaybackStatus, positionSeconds: number) => string | null;
  /**
   * Estimated current server time in epoch ms, or null before the clock has
   * been measured. Local-only; never sent as room state.
   */
  estimateServerNowMs: () => number | null;
};

const NOT_READY = "The room connection is not ready yet.";

/**
 * React adapter for the room session controller. On mount it resumes the
 * session stored for this tab (e.g. after a refresh); on unmount it stops
 * without forgetting that session.
 */
export function useRoom(): UseRoom {
  const [state, setState] = useState<RoomState>({ status: "idle", error: null });
  const sessionRef = useRef<RoomSession | null>(null);

  useEffect(() => {
    const session = createRoomSession({
      openConnection: openRoomConnection,
      startClockSync,
      sessionStore: createSessionStore(browserSessionStorage()),
      onStateChange: setState,
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimer: (handle) => window.clearTimeout(handle as number),
      random: Math.random,
      monotonicNow: () => performance.now(),
    });
    sessionRef.current = session;
    session.resumeStored();

    // Timers may be throttled or the clock paused while hidden; re-measure on return.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        session.resyncClock();
      }
    }
    function handleOnline() {
      session.reconnectNow();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      session.dispose();
      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
    };
  }, []);

  return {
    state,
    createRoom: (displayName) => sessionRef.current?.createRoom(displayName),
    joinRoom: (roomCode, displayName) => sessionRef.current?.joinRoom(roomCode, displayName),
    leaveRoom: () => sessionRef.current?.leave(),
    // A null result means the command was sent; only a missing session is "not ready".
    setMedia: (media) =>
      sessionRef.current ? sessionRef.current.setMedia(media) : NOT_READY,
    setPlayback: (status, positionSeconds) =>
      sessionRef.current
        ? sessionRef.current.setPlayback(status, positionSeconds)
        : NOT_READY,
    estimateServerNowMs: () => sessionRef.current?.estimateServerNowMs() ?? null,
  };
}
