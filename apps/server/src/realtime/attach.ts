import {
  parseClientMessage,
  type ErrorCode,
  type ParticipantId,
  type RoomId,
  type RoomSnapshot,
  type ServerMessage,
} from "@swarmcue/protocol";
import { WebSocket, type RawData, type WebSocketServer } from "ws";
import type { ConnectionId, RoomStore } from "../rooms/index.js";

/** Timer functions, injectable so tests can fire grace-period wake-ups deterministically. */
export type Scheduler = {
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export const realScheduler: Scheduler = {
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Close code sent to a connection whose session was resumed elsewhere. */
export const SESSION_REPLACED_CLOSE_CODE = 4000;

type Session = {
  roomId: RoomId;
  participantId: ParticipantId;
};

/** One WebSocket connection. `session` is null until it creates, joins, or resumes. */
type Connection = {
  id: ConnectionId;
  socket: WebSocket;
  session: Session | null;
  /** Cleared on each heartbeat ping; set again when the peer answers. */
  alive: boolean;
};

const ERROR_TEXT: Record<
  | "room_not_found"
  | "room_full"
  | "not_host"
  | "not_in_room"
  | "no_media"
  | "resume_rejected"
  | "session_replaced",
  string
> = {
  room_not_found: "No room exists with that code.",
  room_full: "That room is full.",
  not_host: "Only the host can change the media.",
  not_in_room: "Join a room first.",
  no_media: "Nothing is playing yet.",
  resume_rejected: "This room session has ended.",
  session_replaced: "This room was opened in another tab or window.",
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

export type RealtimeOptions = {
  /** Authoritative server clock (epoch ms) reported in clock.pong. */
  now: () => number;
  scheduler: Scheduler;
  /**
   * How often to ping every connection; a connection that has not answered
   * the previous ping is terminated, which starts its grace period. Detects
   * half-open connections (sleeping laptops, dropped Wi-Fi) that never send
   * a close. 0 disables the heartbeat.
   */
  heartbeatIntervalMs: number;
};

/**
 * Translates WebSocket traffic into room-domain operations and owns the
 * association between participants and their current connection.
 *
 * Grace periods: the room store keeps each disconnected participant's
 * deadline; this layer only schedules a wake-up at that deadline and asks the
 * store what has expired. Stale or duplicate wake-ups are harmless.
 *
 * Messages larger than the server's `maxPayload` are rejected by `ws`
 * itself, which closes the connection.
 */
export function attachRealtime(
  wss: WebSocketServer,
  rooms: RoomStore,
  { now, scheduler, heartbeatIntervalMs }: RealtimeOptions,
): void {
  /** Current connection of each participant who is connected, per room. */
  const connectionsByRoom = new Map<RoomId, Map<ParticipantId, Connection>>();
  /** Every open connection, in a room or not; used by the heartbeat. */
  const openConnections = new Set<Connection>();
  const pendingTimers = new Set<unknown>();
  let nextConnectionId: ConnectionId = 1;

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
    send(socket, { type: "error", code, message });
  }

  function bind(connection: Connection, session: Session): void {
    connection.session = session;
    let connections = connectionsByRoom.get(session.roomId);
    if (!connections) {
      connections = new Map();
      connectionsByRoom.set(session.roomId, connections);
    }
    connections.set(session.participantId, connection);
  }

  /** Drops the association only if `connection` is still the participant's current one. */
  function unbind(connection: Connection): void {
    const session = connection.session;
    connection.session = null;
    if (!session) {
      return;
    }
    const connections = connectionsByRoom.get(session.roomId);
    if (connections?.get(session.participantId) === connection) {
      connections.delete(session.participantId);
      if (connections.size === 0) {
        connectionsByRoom.delete(session.roomId);
      }
    }
  }

  function broadcastSnapshot(snapshot: RoomSnapshot, except?: Connection): void {
    const connections = connectionsByRoom.get(snapshot.roomId);
    if (!connections) {
      return;
    }
    for (const connection of connections.values()) {
      if (connection !== except) {
        send(connection.socket, { type: "room.snapshot", snapshot });
      }
    }
  }

  function processExpirations(): void {
    for (const { roomId, snapshot } of rooms.expireDue()) {
      if (snapshot) {
        broadcastSnapshot(snapshot);
      } else {
        connectionsByRoom.delete(roomId);
      }
    }
  }

  function schedule(callback: () => void, delayMs: number): void {
    const handle = scheduler.setTimer(() => {
      pendingTimers.delete(handle);
      callback();
    }, delayMs);
    pendingTimers.add(handle);
  }

  function scheduleWakeUp(atMs: number): void {
    schedule(processExpirations, Math.max(0, atMs - now()));
  }

  function heartbeat(): void {
    for (const connection of openConnections) {
      if (!connection.alive) {
        // Emits `close`, which starts the participant's grace period.
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
    }
    schedule(heartbeat, heartbeatIntervalMs);
  }

  if (heartbeatIntervalMs > 0) {
    schedule(heartbeat, heartbeatIntervalMs);
  }

  wss.on("close", () => {
    for (const handle of pendingTimers) {
      scheduler.clearTimer(handle);
    }
    pendingTimers.clear();
  });

  wss.on("connection", (socket) => {
    const connection: Connection = {
      id: nextConnectionId++,
      socket,
      session: null,
      alive: true,
    };
    openConnections.add(connection);
    socket.on("pong", () => {
      connection.alive = true;
    });

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
      const session = connection.session;
      switch (message.type) {
        case "clock.ping": {
          // Needs no room session; answer immediately so the client's
          // round-trip measurement includes as little server time as possible.
          send(socket, { type: "clock.pong", id: message.id, serverTimeMs: now() });
          return;
        }
        case "room.create": {
          if (session) {
            sendAlreadyInRoom();
            return;
          }
          const { participant, resumeToken, snapshot } = rooms.createRoom(
            message.displayName,
            connection.id,
          );
          bind(connection, { roomId: snapshot.roomId, participantId: participant.id });
          send(socket, { type: "room.joined", selfId: participant.id, resumeToken, snapshot });
          return;
        }
        case "room.join": {
          if (session) {
            sendAlreadyInRoom();
            return;
          }
          const result = rooms.joinRoom(message.roomId, message.displayName, connection.id);
          if (!result.ok) {
            sendError(socket, result.error, ERROR_TEXT[result.error]);
            return;
          }
          const { participant, resumeToken, snapshot } = result;
          bind(connection, { roomId: snapshot.roomId, participantId: participant.id });
          send(socket, { type: "room.joined", selfId: participant.id, resumeToken, snapshot });
          broadcastSnapshot(snapshot, connection);
          return;
        }
        case "room.resume": {
          if (session) {
            sendAlreadyInRoom();
            return;
          }
          // Apply any due expirations first, so a resume racing its own
          // deadline sees the same state the wake-up would produce.
          processExpirations();
          const result = rooms.resume(message.roomId, message.resumeToken, connection.id);
          if (!result.ok) {
            // Never echo the token or say why; every failure looks the same.
            sendError(socket, "resume_rejected", ERROR_TEXT.resume_rejected);
            return;
          }

          const previous = connectionsByRoom
            .get(message.roomId)
            ?.get(result.participantId);
          if (previous && previous.id === result.replacedConnectionId) {
            // Detach first, so the old socket's close event cannot affect the session.
            unbind(previous);
            sendError(previous.socket, "session_replaced", ERROR_TEXT.session_replaced);
            previous.socket.close(SESSION_REPLACED_CLOSE_CODE, "session replaced");
          }

          bind(connection, { roomId: message.roomId, participantId: result.participantId });
          send(socket, {
            type: "room.resumed",
            selfId: result.participantId,
            snapshot: result.snapshot,
          });
          if (result.changed) {
            broadcastSnapshot(result.snapshot, connection);
          }
          return;
        }
        case "room.leave": {
          if (!session) {
            sendError(socket, "not_in_room", ERROR_TEXT.not_in_room);
            return;
          }
          const result = rooms.leave(session.roomId, session.participantId, connection.id);
          unbind(connection);
          if (!result.ok) {
            return;
          }
          if (result.snapshot) {
            broadcastSnapshot(result.snapshot);
          } else {
            connectionsByRoom.delete(session.roomId);
          }
          return;
        }
        case "media.set": {
          if (!session) {
            sendError(socket, "not_in_room", "Join a room before sharing media.");
            return;
          }
          // Permission is checked against the server-side session, never client data.
          const result = rooms.setMedia(session.roomId, session.participantId, message.media);
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
          const result = rooms.setPlayback(session.roomId, session.participantId, {
            status: message.status,
            positionSeconds: message.positionSeconds,
          });
          if (!result.ok) {
            sendError(socket, result.error, ERROR_TEXT[result.error]);
            return;
          }
          // A request matching the current timeline is not re-broadcast, so
          // clients echoing the state they just applied cannot cause loops.
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
      openConnections.delete(connection);
      const session = connection.session;
      if (!session) {
        return;
      }
      unbind(connection);
      // The domain ignores this if another connection has taken over.
      const result = rooms.markDisconnected(
        session.roomId,
        session.participantId,
        connection.id,
      );
      if (result.changed) {
        broadcastSnapshot(result.snapshot);
        scheduleWakeUp(result.expiresAtMs);
      }
    });

    socket.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  });
}
