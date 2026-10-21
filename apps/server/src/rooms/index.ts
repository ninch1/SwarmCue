/**
 * In-memory room domain. This module must not import WebSocket or HTTP types.
 */
import type {
  Participant,
  ParticipantId,
  RoomId,
  RoomSnapshot,
} from "@swarmcue/protocol";

export type RoomStoreOptions = {
  generateRoomId: () => RoomId;
  generateParticipantId: () => ParticipantId;
  maxParticipants: number;
};

export type JoinRoomError = "room_not_found" | "room_full";

export type EnteredRoom = {
  participant: Participant;
  snapshot: RoomSnapshot;
};

export type JoinRoomResult =
  | ({ ok: true } & EnteredRoom)
  | { ok: false; error: JoinRoomError };

type Room = {
  id: RoomId;
  /** Join order. */
  participants: Participant[];
};

const MAX_ROOM_ID_ATTEMPTS = 10;

export function createRoomStore(options: RoomStoreOptions) {
  const rooms = new Map<RoomId, Room>();

  function toSnapshot(room: Room): RoomSnapshot {
    return {
      roomId: room.id,
      participants: room.participants.map((participant) => ({ ...participant })),
    };
  }

  function generateUniqueRoomId(): RoomId {
    for (let attempt = 0; attempt < MAX_ROOM_ID_ATTEMPTS; attempt += 1) {
      const id = options.generateRoomId();
      if (!rooms.has(id)) {
        return id;
      }
    }
    throw new Error("Failed to generate a unique room id.");
  }

  function addParticipant(room: Room, displayName: string): Participant {
    const participant: Participant = {
      id: options.generateParticipantId(),
      displayName,
    };
    room.participants.push(participant);
    return participant;
  }

  return {
    createRoom(displayName: string): EnteredRoom {
      const room: Room = { id: generateUniqueRoomId(), participants: [] };
      rooms.set(room.id, room);
      const participant = addParticipant(room, displayName);
      return { participant: { ...participant }, snapshot: toSnapshot(room) };
    },

    joinRoom(roomId: RoomId, displayName: string): JoinRoomResult {
      const room = rooms.get(roomId);
      if (!room) {
        return { ok: false, error: "room_not_found" };
      }
      if (room.participants.length >= options.maxParticipants) {
        return { ok: false, error: "room_full" };
      }
      const participant = addParticipant(room, displayName);
      return {
        ok: true,
        participant: { ...participant },
        snapshot: toSnapshot(room),
      };
    },

    /**
     * Remove a participant. Returns the updated snapshot, or null when the
     * room no longer exists (unknown, or deleted because it became empty).
     */
    leaveRoom(roomId: RoomId, participantId: ParticipantId): RoomSnapshot | null {
      const room = rooms.get(roomId);
      if (!room) {
        return null;
      }
      room.participants = room.participants.filter(
        (participant) => participant.id !== participantId,
      );
      if (room.participants.length === 0) {
        rooms.delete(roomId);
        return null;
      }
      return toSnapshot(room);
    },

    getSnapshot(roomId: RoomId): RoomSnapshot | null {
      const room = rooms.get(roomId);
      return room ? toSnapshot(room) : null;
    },
  };
}

export type RoomStore = ReturnType<typeof createRoomStore>;
