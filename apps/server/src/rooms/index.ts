/**
 * In-memory room domain. This module must not import WebSocket or HTTP types.
 *
 * Time comes only from the injected `now()`. Disconnected participants carry
 * a deadline (`expiresAtMs`); the store never schedules timers itself.
 * Callers wake it up with `expireDue()`, and a stale or duplicate wake-up is
 * harmless because expiry is decided here against the deadline.
 */
import { isEquivalentPlayback } from "@swarmcue/playback-sync";
import type {
  Participant,
  ParticipantId,
  PlaybackState,
  PlaybackStatus,
  ResumeToken,
  RoomId,
  RoomSnapshot,
  SharedMedia,
} from "@swarmcue/protocol";

export type RoomStoreOptions = {
  generateRoomId: () => RoomId;
  generateParticipantId: () => ParticipantId;
  generateResumeToken: () => ResumeToken;
  /** One-way hash; the store keeps only hashes of resume tokens. */
  hashResumeToken: (token: ResumeToken) => string;
  maxParticipants: number;
  /** How long a disconnected participant keeps their place, in ms. */
  graceMs: number;
  /** Server clock in epoch ms. */
  now: () => number;
};

/**
 * Identifies one transport connection. Every lifecycle operation names the
 * connection it comes from, so events from a replaced connection are ignored.
 */
export type ConnectionId = number;

export type PlaybackRequest = {
  status: PlaybackStatus;
  positionSeconds: number;
};

export type JoinRoomError = "room_not_found" | "room_full";

export type EnteredRoom = {
  participant: Participant;
  /** Secret; must only ever be sent to this participant. */
  resumeToken: ResumeToken;
  snapshot: RoomSnapshot;
};

export type JoinRoomResult =
  | ({ ok: true } & EnteredRoom)
  | { ok: false; error: JoinRoomError };

export type DisconnectResult =
  | { changed: false }
  | { changed: true; snapshot: RoomSnapshot; expiresAtMs: number };

export type ResumeResult =
  | {
      ok: true;
      participantId: ParticipantId;
      snapshot: RoomSnapshot;
      /** The connection this resume took over, if the old one was still open. */
      replacedConnectionId: ConnectionId | null;
      /** True when the participant's connection status changed for others. */
      changed: boolean;
    }
  | { ok: false; error: "resume_rejected" };

export type LeaveResult =
  /** `snapshot` is null when the room was deleted because it became empty. */
  | { ok: true; snapshot: RoomSnapshot | null }
  | { ok: false };

export type ExpiredRoom = {
  roomId: RoomId;
  /** Null when the room was deleted because nobody was left. */
  snapshot: RoomSnapshot | null;
};

export type SetMediaError = "room_not_found" | "not_host";

export type SetMediaResult =
  | { ok: true; snapshot: RoomSnapshot }
  | { ok: false; error: SetMediaError };

export type SetPlaybackError = "room_not_found" | "not_in_room" | "no_media";

export type SetPlaybackResult =
  /** `changed` is false when the request matches the current timeline. */
  | { ok: true; changed: boolean; snapshot: RoomSnapshot }
  | { ok: false; error: SetPlaybackError };

type ParticipantRecord = {
  id: ParticipantId;
  displayName: string;
  resumeTokenHash: string;
  connection:
    | { state: "connected"; connectionId: ConnectionId }
    | { state: "disconnected"; expiresAtMs: number };
};

type Room = {
  id: RoomId;
  hostId: ParticipantId;
  /** Join order. */
  participants: ParticipantRecord[];
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
      // Deliberately lists fields: the token hash must never leave the store.
      participants: room.participants.map((participant) => ({
        id: participant.id,
        displayName: participant.displayName,
        connected: participant.connection.state === "connected",
      })),
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

  function newParticipant(
    displayName: string,
    connectionId: ConnectionId,
  ): { record: ParticipantRecord; resumeToken: ResumeToken } {
    const resumeToken = options.generateResumeToken();
    return {
      resumeToken,
      record: {
        id: options.generateParticipantId(),
        displayName,
        resumeTokenHash: options.hashResumeToken(resumeToken),
        connection: { state: "connected", connectionId },
      },
    };
  }

  function publicParticipant(record: ParticipantRecord): Participant {
    return {
      id: record.id,
      displayName: record.displayName,
      connected: record.connection.state === "connected",
    };
  }

  function isCurrentConnection(
    record: ParticipantRecord,
    connectionId: ConnectionId,
  ): boolean {
    return (
      record.connection.state === "connected" &&
      record.connection.connectionId === connectionId
    );
  }

  /**
   * Remove participants and, if the host was among them, hand host to the
   * earliest-joined connected participant (or, if nobody is connected, the
   * earliest-joined remaining one). Deletes the room when it becomes empty.
   * Returns the new snapshot, or null if the room was deleted.
   */
  function removeParticipants(
    room: Room,
    shouldRemove: (record: ParticipantRecord) => boolean,
  ): RoomSnapshot | null {
    room.participants = room.participants.filter((record) => !shouldRemove(record));
    if (room.participants.length === 0) {
      rooms.delete(room.id);
      return null;
    }
    if (!room.participants.some((record) => record.id === room.hostId)) {
      const nextHost =
        room.participants.find((record) => record.connection.state === "connected") ??
        room.participants[0];
      if (nextHost) {
        room.hostId = nextHost.id;
      }
    }
    return toSnapshot(room);
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
    createRoom(displayName: string, connectionId: ConnectionId): EnteredRoom {
      const { record, resumeToken } = newParticipant(displayName, connectionId);
      const room: Room = {
        id: generateUniqueRoomId(),
        hostId: record.id,
        participants: [record],
        media: null,
        playback: pausedAtStart(0),
      };
      rooms.set(room.id, room);
      return {
        participant: publicParticipant(record),
        resumeToken,
        snapshot: toSnapshot(room),
      };
    },

    /** Disconnected participants keep their seat, so they count toward capacity. */
    joinRoom(
      roomId: RoomId,
      displayName: string,
      connectionId: ConnectionId,
    ): JoinRoomResult {
      const room = rooms.get(roomId);
      if (!room) {
        return { ok: false, error: "room_not_found" };
      }
      if (room.participants.length >= options.maxParticipants) {
        return { ok: false, error: "room_full" };
      }
      const { record, resumeToken } = newParticipant(displayName, connectionId);
      room.participants.push(record);
      return {
        ok: true,
        participant: publicParticipant(record),
        resumeToken,
        snapshot: toSnapshot(room),
      };
    },

    /**
     * The participant's connection dropped. They stay in the room (a host
     * stays host) until `now + graceMs`. Ignored if `connectionId` is not
     * their current connection or they are already disconnected, so a
     * replaced socket closing late cannot affect the new one.
     */
    markDisconnected(
      roomId: RoomId,
      participantId: ParticipantId,
      connectionId: ConnectionId,
    ): DisconnectResult {
      const room = rooms.get(roomId);
      const record = room?.participants.find((p) => p.id === participantId);
      if (!room || !record || !isCurrentConnection(record, connectionId)) {
        return { changed: false };
      }
      const expiresAtMs = options.now() + options.graceMs;
      record.connection = { state: "disconnected", expiresAtMs };
      return { changed: true, snapshot: toSnapshot(room), expiresAtMs };
    },

    /**
     * Reclaim a session with its secret token. Succeeds while the participant
     * is connected (the newest connection takes over) or disconnected with
     * `now < expiresAtMs`. A participant ID alone can never resume.
     */
    resume(
      roomId: RoomId,
      resumeToken: ResumeToken,
      connectionId: ConnectionId,
    ): ResumeResult {
      const room = rooms.get(roomId);
      if (!room) {
        return { ok: false, error: "resume_rejected" };
      }
      // Comparing hashes: timing can at most reveal parts of a SHA-256
      // digest, which does not help recover the token.
      const tokenHash = options.hashResumeToken(resumeToken);
      const record = room.participants.find((p) => p.resumeTokenHash === tokenHash);
      if (!record) {
        return { ok: false, error: "resume_rejected" };
      }

      if (record.connection.state === "connected") {
        const replacedConnectionId = record.connection.connectionId;
        record.connection = { state: "connected", connectionId };
        return {
          ok: true,
          participantId: record.id,
          snapshot: toSnapshot(room),
          replacedConnectionId,
          changed: false,
        };
      }

      if (options.now() >= record.connection.expiresAtMs) {
        return { ok: false, error: "resume_rejected" };
      }
      record.connection = { state: "connected", connectionId };
      return {
        ok: true,
        participantId: record.id,
        snapshot: toSnapshot(room),
        replacedConnectionId: null,
        changed: true,
      };
    },

    /**
     * Deliberate leave: removes the participant immediately, skipping the
     * grace period, and transfers host right away if needed.
     */
    leave(
      roomId: RoomId,
      participantId: ParticipantId,
      connectionId: ConnectionId,
    ): LeaveResult {
      const room = rooms.get(roomId);
      const record = room?.participants.find((p) => p.id === participantId);
      if (!room || !record || !isCurrentConnection(record, connectionId)) {
        return { ok: false };
      }
      return { ok: true, snapshot: removeParticipants(room, (p) => p.id === participantId) };
    },

    /**
     * Remove every disconnected participant whose grace period has ended
     * (`expiresAtMs <= now`). Idempotent: participants are removed exactly
     * once, and calling it with nothing due changes nothing.
     */
    expireDue(): ExpiredRoom[] {
      const nowMs = options.now();
      const isDue = (record: ParticipantRecord) =>
        record.connection.state === "disconnected" &&
        record.connection.expiresAtMs <= nowMs;

      const expired: ExpiredRoom[] = [];
      for (const room of [...rooms.values()]) {
        if (room.participants.some(isDue)) {
          expired.push({ roomId: room.id, snapshot: removeParticipants(room, isDue) });
        }
      }
      return expired;
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
