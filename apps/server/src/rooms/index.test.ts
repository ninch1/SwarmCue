import { RoomIdSchema } from "@swarmcue/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { generateRoomId } from "./ids.js";
import { createRoomStore } from "./index.js";

const START_MS = 1_700_000_000_000;
/** Server clock shared by every test store; reset before each test. */
const clock = { nowMs: START_MS };

beforeEach(() => {
  clock.nowMs = START_MS;
});

function createTestStore(options: {
  roomIds?: string[];
  maxParticipants?: number;
} = {}) {
  const roomIds = [...(options.roomIds ?? ["AAAAAAAA", "BBBBBBBB", "CCCCCCCC"])];
  let participantCount = 0;

  return createRoomStore({
    generateRoomId: () => {
      const id = roomIds.shift();
      if (!id) {
        throw new Error("Test ran out of room ids");
      }
      return id;
    },
    generateParticipantId: () => {
      participantCount += 1;
      return `p${participantCount}`;
    },
    maxParticipants: options.maxParticipants ?? 5,
    now: () => clock.nowMs,
  });
}

const initialPlayback = {
  status: "paused",
  positionSeconds: 0,
  updatedAtServerMs: START_MS,
  revision: 0,
} as const;

const media = {
  magnetUri: "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056",
  name: "movie.mp4",
  sizeBytes: 1024,
};

describe("createRoomStore", () => {
  it("creates a room containing only the creator, who is host", () => {
    const store = createTestStore();

    const { participant, snapshot } = store.createRoom("Ada");

    expect(participant).toEqual({ id: "p1", displayName: "Ada" });
    expect(snapshot).toEqual({
      roomId: "AAAAAAAA",
      hostId: "p1",
      participants: [{ id: "p1", displayName: "Ada" }],
      media: null,
      playback: initialPlayback,
    });
  });

  it("gives joiners the same snapshot in join order without making them host", () => {
    const store = createTestStore();
    const created = store.createRoom("Ada");

    const joined = store.joinRoom(created.snapshot.roomId, "Grace");

    expect(joined).toEqual({
      ok: true,
      participant: { id: "p2", displayName: "Grace" },
      snapshot: {
        roomId: "AAAAAAAA",
        hostId: "p1",
        participants: [
          { id: "p1", displayName: "Ada" },
          { id: "p2", displayName: "Grace" },
        ],
        media: null,
        playback: initialPlayback,
      },
    });
    expect(store.getSnapshot("AAAAAAAA")).toEqual(
      joined.ok ? joined.snapshot : null,
    );
  });

  it("rejects joining an unknown room", () => {
    const store = createTestStore();

    expect(store.joinRoom("ZZZZZZZZ", "Grace")).toEqual({
      ok: false,
      error: "room_not_found",
    });
  });

  it("rejects joining a full room", () => {
    const store = createTestStore({ maxParticipants: 2 });
    const { snapshot } = store.createRoom("Ada");
    store.joinRoom(snapshot.roomId, "Grace");

    expect(store.joinRoom(snapshot.roomId, "Linus")).toEqual({
      ok: false,
      error: "room_full",
    });
    expect(store.getSnapshot(snapshot.roomId)?.participants).toHaveLength(2);
  });

  it("keeps the host when a non-host participant leaves", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada");
    store.joinRoom(snapshot.roomId, "Grace");

    expect(store.leaveRoom(snapshot.roomId, "p2")).toEqual({
      roomId: "AAAAAAAA",
      hostId: "p1",
      participants: [{ id: "p1", displayName: "Ada" }],
      media: null,
      playback: initialPlayback,
    });
  });

  it("promotes the earliest-joined remaining participant when the host leaves", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada");
    store.joinRoom(snapshot.roomId, "Grace");
    store.joinRoom(snapshot.roomId, "Linus");

    expect(store.leaveRoom(snapshot.roomId, "p1")).toEqual({
      roomId: "AAAAAAAA",
      hostId: "p2",
      participants: [
        { id: "p2", displayName: "Grace" },
        { id: "p3", displayName: "Linus" },
      ],
      media: null,
      playback: initialPlayback,
    });
  });

  it("deletes the room when the last participant leaves", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada");

    expect(store.leaveRoom(snapshot.roomId, "p1")).toBeNull();
    expect(store.getSnapshot(snapshot.roomId)).toBeNull();
    expect(store.joinRoom(snapshot.roomId, "Grace")).toEqual({
      ok: false,
      error: "room_not_found",
    });
  });

  it("skips generated room ids that are already in use", () => {
    const store = createTestStore({ roomIds: ["AAAAAAAA", "AAAAAAAA", "BBBBBBBB"] });

    store.createRoom("Ada");
    const second = store.createRoom("Grace");

    expect(second.snapshot.roomId).toBe("BBBBBBBB");
  });

  it("does not expose internal state through returned snapshots", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada");

    snapshot.participants.push({ id: "intruder", displayName: "Eve" });

    expect(store.getSnapshot(snapshot.roomId)?.participants).toHaveLength(1);
  });
});

describe("setMedia", () => {
  it("lets the host set media and returns the updated snapshot", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada");
    store.joinRoom(snapshot.roomId, "Grace");

    const result = store.setMedia(snapshot.roomId, "p1", media);

    expect(result).toEqual({
      ok: true,
      snapshot: {
        roomId: "AAAAAAAA",
        hostId: "p1",
        participants: [
          { id: "p1", displayName: "Ada" },
          { id: "p2", displayName: "Grace" },
        ],
        media,
        playback: { ...initialPlayback, revision: 1 },
      },
    });
    expect(store.getSnapshot(snapshot.roomId)?.media).toEqual(media);
  });

  it("rejects a non-host and leaves the state unchanged", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada");
    store.joinRoom(snapshot.roomId, "Grace");

    expect(store.setMedia(snapshot.roomId, "p2", media)).toEqual({
      ok: false,
      error: "not_host",
    });
    expect(store.getSnapshot(snapshot.roomId)?.media).toBeNull();
  });

  it("rejects an unknown room", () => {
    const store = createTestStore();

    expect(store.setMedia("ZZZZZZZZ", "p1", media)).toEqual({
      ok: false,
      error: "room_not_found",
    });
  });

  it("keeps the media when the host leaves and lets the new host replace it", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada");
    store.joinRoom(snapshot.roomId, "Grace");
    store.setMedia(snapshot.roomId, "p1", media);

    const afterLeave = store.leaveRoom(snapshot.roomId, "p1");
    expect(afterLeave?.media).toEqual(media);

    const replacement = { ...media, name: "other.mp4" };
    expect(store.setMedia(snapshot.roomId, "p2", replacement).ok).toBe(true);
    expect(store.getSnapshot(snapshot.roomId)?.media).toEqual(replacement);
  });

  it("does not expose stored media through snapshots or the caller's object", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada");
    const input = { ...media };

    const result = store.setMedia(snapshot.roomId, "p1", input);
    input.name = "changed-by-caller";
    if (result.ok && result.snapshot.media) {
      result.snapshot.media.name = "changed-by-receiver";
    }

    expect(store.getSnapshot(snapshot.roomId)?.media).toEqual(media);
  });
});

describe("setPlayback", () => {
  function roomWithMedia() {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada");
    store.joinRoom(snapshot.roomId, "Grace");
    store.setMedia(snapshot.roomId, "p1", media);
    return { store, roomId: snapshot.roomId };
  }

  const play = (positionSeconds: number) =>
    ({ status: "playing", positionSeconds }) as const;
  const pause = (positionSeconds: number) =>
    ({ status: "paused", positionSeconds }) as const;

  it("lets any participant play, pause, and seek, timestamping each change", () => {
    const { store, roomId } = roomWithMedia();

    expect(store.setPlayback(roomId, "p2", play(0))).toMatchObject({
      ok: true,
      changed: true,
      snapshot: {
        playback: {
          status: "playing",
          positionSeconds: 0,
          updatedAtServerMs: START_MS,
          revision: 2,
        },
      },
    });

    clock.nowMs += 5000;
    expect(store.setPlayback(roomId, "p1", pause(5))).toMatchObject({
      ok: true,
      changed: true,
      snapshot: {
        playback: {
          status: "paused",
          positionSeconds: 5,
          updatedAtServerMs: START_MS + 5000,
          revision: 3,
        },
      },
    });

    clock.nowMs += 1000;
    expect(store.setPlayback(roomId, "p2", pause(60))).toMatchObject({
      ok: true,
      changed: true,
      snapshot: {
        playback: {
          status: "paused",
          positionSeconds: 60,
          updatedAtServerMs: START_MS + 6000,
          revision: 4,
        },
      },
    });
  });

  it("reports no change for a request that matches the current timeline", () => {
    const { store, roomId } = roomWithMedia();
    store.setPlayback(roomId, "p1", play(0));
    clock.nowMs += 2000;

    // Expected position is now 2 s; 2.1 s is within the tolerance.
    expect(store.setPlayback(roomId, "p2", play(2.1))).toMatchObject({
      ok: true,
      changed: false,
      snapshot: {
        playback: { status: "playing", positionSeconds: 0, updatedAtServerMs: START_MS, revision: 2 },
      },
    });
  });

  it("treats a seek while playing as a change", () => {
    const { store, roomId } = roomWithMedia();
    store.setPlayback(roomId, "p1", play(0));
    clock.nowMs += 2000;

    expect(store.setPlayback(roomId, "p2", play(30))).toMatchObject({
      ok: true,
      changed: true,
      snapshot: { playback: { status: "playing", positionSeconds: 30, revision: 3 } },
    });
  });

  it("rejects playback before any media is shared", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada");

    expect(store.setPlayback(snapshot.roomId, "p1", play(0))).toEqual({
      ok: false,
      error: "no_media",
    });
    expect(store.getSnapshot(snapshot.roomId)?.playback).toEqual(initialPlayback);
  });

  it("rejects unknown rooms and non-members", () => {
    const { store, roomId } = roomWithMedia();

    expect(store.setPlayback("ZZZZZZZZ", "p1", play(0))).toEqual({
      ok: false,
      error: "room_not_found",
    });
    expect(store.setPlayback(roomId, "intruder", play(0))).toEqual({
      ok: false,
      error: "not_in_room",
    });
  });

  it("resets to paused at 0 with a new revision when the host changes media", () => {
    const { store, roomId } = roomWithMedia();
    store.setPlayback(roomId, "p2", play(40));
    clock.nowMs += 3000;

    const result = store.setMedia(roomId, "p1", { ...media, name: "other.mp4" });

    expect(result.ok && result.snapshot.playback).toEqual({
      status: "paused",
      positionSeconds: 0,
      updatedAtServerMs: START_MS + 3000,
      revision: 3,
    });
  });

  it("keeps the playback state when the host leaves", () => {
    const { store, roomId } = roomWithMedia();
    store.setPlayback(roomId, "p1", play(12));

    expect(store.leaveRoom(roomId, "p1")?.playback).toEqual({
      status: "playing",
      positionSeconds: 12,
      updatedAtServerMs: START_MS,
      revision: 2,
    });
  });
});

describe("generateRoomId", () => {
  it("produces codes that match the protocol format", () => {
    for (let index = 0; index < 100; index += 1) {
      expect(RoomIdSchema.safeParse(generateRoomId()).success).toBe(true);
    }
  });
});
