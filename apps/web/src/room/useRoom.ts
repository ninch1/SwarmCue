import {
  ClientMessageSchema,
  ProtocolVersion,
  type ClientMessage,
  type ParticipantId,
  type PlaybackStatus,
  type RoomSnapshot,
  type SharedMedia,
} from "@swarmcue/protocol";
import { useEffect, useRef, useState } from "react";
import { startClockSync, type ClockSync } from "../clock/clockSync.js";
import { openRoomConnection, type RoomConnection } from "./connection.js";
import { normalizeRoomCode } from "./roomCode.js";

export type RoomState =
  | { status: "idle"; error: string | null }
  | { status: "connecting" }
  | {
      status: "in-room";
      selfId: ParticipantId;
      snapshot: RoomSnapshot;
      /** Latest server error while in the room; cleared by the next snapshot. */
      error: string | null;
    };

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
   * Estimated current server time in epoch ms, or null before the current
   * connection has measured the clock. Local-only; never sent as room state.
   */
  estimateServerNowMs: () => number | null;
};

/** Returns the validated message, or the first validation message as a string. */
function validateClientMessage(
  rawMessage: unknown,
  fallback: string,
): ClientMessage | string {
  const parsed = ClientMessageSchema.safeParse(rawMessage);
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? fallback;
  }
  return parsed.data;
}

/**
 * One WebSocket per room session: opened on create/join, closed on leave.
 * There is no reconnection yet, so a dropped connection returns to idle.
 */
export function useRoom(): UseRoom {
  const [state, setState] = useState<RoomState>({ status: "idle", error: null });
  const connectionRef = useRef<RoomConnection | null>(null);
  /** The connection that has completed create/join; null while connecting or idle. */
  const joinedConnectionRef = useRef<RoomConnection | null>(null);
  /** Clock estimation for the current connection; a new connection starts fresh. */
  const clockRef = useRef<ClockSync | null>(null);

  function disposeClock(): void {
    clockRef.current?.dispose();
    clockRef.current = null;
  }

  useEffect(() => {
    return () => {
      disposeClock();
      const connection = connectionRef.current;
      connectionRef.current = null;
      connection?.close();
    };
  }, []);

  // Timers may be throttled or the clock paused while hidden; re-measure on return.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        clockRef.current?.resyncNow();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  function closeCurrent(): void {
    disposeClock();
    const connection = connectionRef.current;
    connectionRef.current = null;
    joinedConnectionRef.current = null;
    connection?.close();
  }

  function start(rawMessage: unknown): void {
    // Validate locally first so the user gets immediate, specific feedback.
    const firstMessage = validateClientMessage(rawMessage, "Invalid room details.");
    if (typeof firstMessage === "string") {
      setState({ status: "idle", error: firstMessage });
      return;
    }

    closeCurrent();
    setState({ status: "connecting" });

    let joined = false;
    const connection = openRoomConnection({
      onOpen: () => {
        connection.send(firstMessage);
        if (connectionRef.current !== connection) {
          return;
        }
        disposeClock();
        clockRef.current = startClockSync({
          sendPing: (id) => {
            connection.send({ type: "clock.ping", protocolVersion: ProtocolVersion, id });
          },
        });
      },
      onMessage: (message) => {
        if (connectionRef.current !== connection) {
          return;
        }
        switch (message.type) {
          case "clock.pong":
            clockRef.current?.handlePong(message);
            return;
          case "room.joined":
            joined = true;
            joinedConnectionRef.current = connection;
            setState({
              status: "in-room",
              selfId: message.selfId,
              snapshot: message.snapshot,
              error: null,
            });
            return;
          case "room.snapshot":
            setState((previous) =>
              previous.status === "in-room"
                ? { ...previous, snapshot: message.snapshot, error: null }
                : previous,
            );
            return;
          case "error":
            if (joined) {
              setState((previous) =>
                previous.status === "in-room"
                  ? { ...previous, error: message.message }
                  : previous,
              );
              return;
            }
            closeCurrent();
            setState({ status: "idle", error: message.message });
            return;
        }
      },
      onClose: () => {
        // Ignore sockets we already replaced or closed on purpose.
        if (connectionRef.current !== connection) {
          return;
        }
        disposeClock();
        connectionRef.current = null;
        joinedConnectionRef.current = null;
        setState({
          status: "idle",
          error: joined
            ? "Disconnected from the room server."
            : "Could not connect to the room server.",
        });
      },
    });
    connectionRef.current = connection;
  }

  return {
    state,
    createRoom: (displayName) => {
      start({ type: "room.create", protocolVersion: ProtocolVersion, displayName });
    },
    joinRoom: (roomCode, displayName) => {
      start({
        type: "room.join",
        protocolVersion: ProtocolVersion,
        roomId: normalizeRoomCode(roomCode),
        displayName,
      });
    },
    leaveRoom: () => {
      closeCurrent();
      setState({ status: "idle", error: null });
    },
    setMedia: (media) => {
      // A ref, not `state`: callers may invoke this after an async step.
      const connection = joinedConnectionRef.current;
      if (!connection) {
        return "Join a room before sharing media.";
      }
      const message = validateClientMessage(
        { type: "media.set", protocolVersion: ProtocolVersion, media },
        "This media cannot be shared.",
      );
      if (typeof message === "string") {
        return message;
      }
      connection.send(message);
      return null;
    },
    setPlayback: (status, positionSeconds) => {
      const connection = joinedConnectionRef.current;
      if (!connection) {
        return "Join a room before controlling playback.";
      }
      const message = validateClientMessage(
        { type: "playback.set", protocolVersion: ProtocolVersion, status, positionSeconds },
        "Invalid playback command.",
      );
      if (typeof message === "string") {
        return message;
      }
      connection.send(message);
      return null;
    },
    estimateServerNowMs: () => clockRef.current?.estimateServerNowMs() ?? null,
  };
}
