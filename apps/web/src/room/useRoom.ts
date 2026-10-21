import {
  ClientMessageSchema,
  ProtocolVersion,
  type ParticipantId,
  type RoomSnapshot,
} from "@swarmcue/protocol";
import { useEffect, useRef, useState } from "react";
import { openRoomConnection, type RoomConnection } from "./connection.js";
import { normalizeRoomCode } from "./roomCode.js";

export type RoomState =
  | { status: "idle"; error: string | null }
  | { status: "connecting" }
  | { status: "in-room"; selfId: ParticipantId; snapshot: RoomSnapshot };

export type UseRoom = {
  state: RoomState;
  createRoom: (displayName: string) => void;
  joinRoom: (roomCode: string, displayName: string) => void;
  leaveRoom: () => void;
};

/**
 * One WebSocket per room session: opened on create/join, closed on leave.
 * There is no reconnection yet, so a dropped connection returns to idle.
 */
export function useRoom(): UseRoom {
  const [state, setState] = useState<RoomState>({ status: "idle", error: null });
  const connectionRef = useRef<RoomConnection | null>(null);

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
    connection?.close();
  }

  function start(rawMessage: unknown): void {
    // Validate locally first so the user gets immediate, specific feedback.
    const parsed = ClientMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      setState({
        status: "idle",
        error: parsed.error.issues[0]?.message ?? "Invalid room details.",
      });
      return;
    }
    const firstMessage = parsed.data;

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
            setState({
              status: "in-room",
              selfId: message.selfId,
              snapshot: message.snapshot,
            });
            return;
          case "room.snapshot":
            setState((previous) =>
              previous.status === "in-room"
                ? { ...previous, snapshot: message.snapshot }
                : previous,
            );
            return;
          case "error":
            if (joined) {
              console.error("Room server error:", message.code, message.message);
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
  };
}
