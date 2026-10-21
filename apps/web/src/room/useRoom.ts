import {
  ClientMessageSchema,
  ProtocolVersion,
  type ClientMessage,
  type ParticipantId,
  type RoomSnapshot,
  type SharedMedia,
} from "@swarmcue/protocol";
import { useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    return () => {
      const connection = connectionRef.current;
      connectionRef.current = null;
      connection?.close();
    };
  }, []);

  function closeCurrent(): void {
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
      },
      onMessage: (message) => {
        if (connectionRef.current !== connection) {
          return;
        }
        switch (message.type) {
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
  };
}
