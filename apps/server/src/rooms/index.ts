/**
 * In-memory room domain. This module must not import WebSocket or HTTP types.
 */
import { isEquivalentPlayback } from "@swarmcue/playback-sync";
import type {
  Participant,
  ParticipantId,
  PlaybackState,
  PlaybackStatus,
  RoomId,
  RoomSnapshot,
  SharedMedia,
} from "@swarmcue/protocol";

export type RoomStoreOptions = {
  generateRoomId: () => RoomId;
  generateParticipantId: () => ParticipantId;
  maxParticipants: number;
  /** Server clock in epoch ms, used to timestamp playback changes. */
  now: () => number;
};

export type PlaybackRequest = {
  status: PlaybackStatus;
  positionSeconds: number;
};

export type JoinRoomError = "room_not_found" | "room_full";

export type EnteredRoom = {
  participant: Participant;
  snapshot: RoomSnapshot;
};

export type JoinRoomResult =
  | ({ ok: true } & EnteredRoom)
  | { ok: false; error: JoinRoomError };

export type SetMediaError = "room_not_found" | "not_host";

export type SetMediaResult =
  | { ok: true; snapshot: RoomSnapshot }
  | { ok: false; error: SetMediaError };

export type SetPlaybackError = "room_not_found" | "not_in_room" | "no_media";

export type SetPlaybackResult =
  /** `changed` is false when the request matches the current timeline. */
  | { ok: true; changed: boolean; snapshot: RoomSnapshot }
  | { ok: false; error: SetPlaybackError };

type Room = {
  id: RoomId;
  hostId: ParticipantId;
  /** Join order. */
  participants: Participant[];
  media: SharedMedia | null;
  playback: PlaybackState;
};

const MAX_ROOM_ID_ATTEMPTS = 10;

export function createRoomStore(options: RoomStoreOptions) {
  const rooms = new Map<RoomId, Room>();

  function toSnapshot(room: Room): RoomSnapshot {
    return {
      roomId: room.id,
      hostId: room.hostId,
      participants: room.participants.map((participant) => ({ ...participant })),
      media: room.media ? { ...room.media } : null,
      playback: { ...room.playback },
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

  function newParticipant(displayName: string): Participant {
    return { id: options.generateParticipantId(), displayName };
  }

  /** New rooms and new media start paused at the beginning. */
  function pausedAtStart(revision: number): PlaybackState {
    return {
      status: "paused",
      positionSeconds: 0,
      updatedAtServerMs: options.now(),
      revision,
    };
  }

  return {
    createRoom(displayName: string): EnteredRoom {
      const participant = newParticipant(displayName);
      const room: Room = {
        id: generateUniqueRoomId(),
        hostId: participant.id,
        participants: [participant],
        media: null,
        playback: pausedAtStart(0),
      };
      rooms.set(room.id, room);
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
      const participant = newParticipant(displayName);
      room.participants.push(participant);
      return {
        ok: true,
        participant: { ...participant },
        snapshot: toSnapshot(room),
      };
    },

    /**
     * Remove a participant. If the host leaves, the earliest-joined remaining
     * participant becomes host immediately. Returns the updated snapshot, or
     * null when the room no longer exists (unknown, or deleted because it
     * became empty).
     */
    leaveRoom(roomId: RoomId, participantId: ParticipantId): RoomSnapshot | null {
      const room = rooms.get(roomId);
      if (!room) {
        return null;
      }
      room.participants = room.participants.filter(
        (participant) => participant.id !== participantId,
      );
      const nextHost = room.participants[0];
      if (!nextHost) {
        rooms.delete(roomId);
        return null;
      }
      if (room.hostId === participantId) {
        room.hostId = nextHost.id;
      }
      return toSnapshot(room);
    },

    /**
     * Replace the shared media. Only the current host may do this. New media
     * always starts paused at position 0.
     */
    setMedia(
      roomId: RoomId,
      participantId: ParticipantId,
      media: SharedMedia,
    ): SetMediaResult {
      const room = rooms.get(roomId);
      if (!room) {
        return { ok: false, error: "room_not_found" };
      }
      if (room.hostId !== participantId) {
        return { ok: false, error: "not_host" };
      }
      room.media = { ...media };
      room.playback = pausedAtStart(room.playback.revision + 1);
      return { ok: true, snapshot: toSnapshot(room) };
    },

    /**
     * Play, pause, or seek the shared media. Any participant may do this in
     * V1; the server applies commands in arrival order and timestamps the
     * reported position with its own clock.
     */
    setPlayback(
      roomId: RoomId,
      participantId: ParticipantId,
      request: PlaybackRequest,
    ): SetPlaybackResult {
      const room = rooms.get(roomId);
      if (!room) {
        return { ok: false, error: "room_not_found" };
      }
      if (!room.participants.some((participant) => participant.id === participantId)) {
        return { ok: false, error: "not_in_room" };
      }
      if (!room.media) {
        return { ok: false, error: "no_media" };
      }
      const nowMs = options.now();
      // Clients echoing state they just applied land here, which prevents loops.
      if (isEquivalentPlayback(room.playback, request, nowMs)) {
        return { ok: true, changed: false, snapshot: toSnapshot(room) };
      }
      room.playback = {
        status: request.status,
        positionSeconds: request.positionSeconds,
        updatedAtServerMs: nowMs,
        revision: room.playback.revision + 1,
      };
      return { ok: true, changed: true, snapshot: toSnapshot(room) };
    },

    getSnapshot(roomId: RoomId): RoomSnapshot | null {
      const room = rooms.get(roomId);
      return room ? toSnapshot(room) : null;
    },
  };
}

export type RoomStore = ReturnType<typeof createRoomStore>;
