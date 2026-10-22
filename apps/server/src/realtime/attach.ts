import {
  parseClientMessage,
  type ErrorCode,
  type ParticipantId,
  type RoomId,
  type RoomSnapshot,
  type ServerMessage,
} from "@swarmcue/protocol";
import { WebSocket, type RawData, type WebSocketServer } from "ws";
import type { RoomStore } from "../rooms/index.js";

type Session = {
  roomId: RoomId;
  participantId: ParticipantId;
};

const ERROR_TEXT: Record<
  "room_not_found" | "room_full" | "not_host" | "not_in_room" | "no_media",
  string
> = {
  room_not_found: "No room exists with that code.",
  room_full: "That room is full.",
  not_host: "Only the host can change the media.",
  not_in_room: "Join a room first.",
  no_media: "Nothing is playing yet.",
};

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
}

/**
 * Translates WebSocket traffic into room-domain operations. Messages larger
 * than the server's `maxPayload` are rejected by `ws` itself, which closes
 * the connection.
 */
export function attachRealtime(wss: WebSocketServer, rooms: RoomStore): void {
  const socketsByRoom = new Map<RoomId, Set<WebSocket>>();

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
    send(socket, { type: "error", code, message });
  }

  function broadcastSnapshot(snapshot: RoomSnapshot, except?: WebSocket): void {
    const sockets = socketsByRoom.get(snapshot.roomId);
    if (!sockets) {
      return;
    }
    for (const socket of sockets) {
      if (socket !== except) {
        send(socket, { type: "room.snapshot", snapshot });
      }
    }
  }

  wss.on("connection", (socket) => {
    let session: Session | null = null;

    function enterRoom(snapshot: RoomSnapshot, participantId: ParticipantId): void {
      session = { roomId: snapshot.roomId, participantId };

      let sockets = socketsByRoom.get(snapshot.roomId);
      if (!sockets) {
        sockets = new Set();
        socketsByRoom.set(snapshot.roomId, sockets);
      }
      sockets.add(socket);

      send(socket, { type: "room.joined", selfId: participantId, snapshot });
      broadcastSnapshot(snapshot, socket);
    }

    function sendAlreadyInRoom(): void {
      sendError(socket, "already_in_room", "This connection is already in a room.");
    }

    function handleMessage(data: RawData, isBinary: boolean): void {
      if (isBinary) {
        sendError(socket, "invalid_message", "Binary messages are not supported.");
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(rawDataToString(data));
      } catch {
        sendError(socket, "invalid_message", "Message is not valid JSON.");
        return;
      }

      const parsed = parseClientMessage(raw);
      if (!parsed.ok) {
        sendError(socket, parsed.code, parsed.message);
        return;
      }

      const message = parsed.message;
      switch (message.type) {
        case "room.create": {
          if (session) {
            sendAlreadyInRoom();
            return;
          }
          const { participant, snapshot } = rooms.createRoom(message.displayName);
          enterRoom(snapshot, participant.id);
          return;
        }
        case "room.join": {
          if (session) {
            sendAlreadyInRoom();
            return;
          }
          const result = rooms.joinRoom(message.roomId, message.displayName);
          if (!result.ok) {
            sendError(socket, result.error, ERROR_TEXT[result.error]);
            return;
          }
          enterRoom(result.snapshot, result.participant.id);
          return;
        }
        case "media.set": {
          if (!session) {
            sendError(socket, "not_in_room", "Join a room before sharing media.");
            return;
          }
          // Permission is checked against the server-side session, never client data.
          const result = rooms.setMedia(
            session.roomId,
            session.participantId,
            message.media,
          );
          if (!result.ok) {
            sendError(socket, result.error, ERROR_TEXT[result.error]);
            return;
          }
          broadcastSnapshot(result.snapshot);
          return;
        }
        case "playback.set": {
          if (!session) {
            sendError(socket, "not_in_room", ERROR_TEXT.not_in_room);
            return;
          }
          const result = rooms.setPlayback(
            session.roomId,
            session.participantId,
            message.status,
          );
          if (!result.ok) {
            sendError(socket, result.error, ERROR_TEXT[result.error]);
            return;
          }
          // An unchanged status is not re-broadcast, so clients echoing the
          // state they just applied cannot cause message loops.
          if (result.changed) {
            broadcastSnapshot(result.snapshot);
          }
          return;
        }
      }
    }

    socket.on("message", (data, isBinary) => {
      try {
        handleMessage(data, isBinary);
      } catch (error) {
        console.error("Failed to handle client message:", error);
        sendError(socket, "internal_error", "The server could not handle that message.");
      }
    });

    socket.on("close", () => {
      if (!session) {
        return;
      }
      const { roomId, participantId } = session;
      session = null;

      const sockets = socketsByRoom.get(roomId);
      sockets?.delete(socket);
      if (sockets?.size === 0) {
        socketsByRoom.delete(roomId);
      }

      const snapshot = rooms.leaveRoom(roomId, participantId);
      if (snapshot) {
        broadcastSnapshot(snapshot);
      }
    });

    socket.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  });
}
