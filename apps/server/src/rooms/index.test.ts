import { RoomIdSchema } from "@swarmcue/protocol";
import { describe, expect, it } from "vitest";
import { generateRoomId } from "./ids.js";
import { createRoomStore } from "./index.js";

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
  });
}

const initialPlayback = { status: "paused", revision: 0 } as const;

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
        playback: { status: "paused", revision: 1 },
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

  it("lets any participant play and pause, bumping the revision each time", () => {
    const { store, roomId } = roomWithMedia();

    const played = store.setPlayback(roomId, "p2", "playing");
    expect(played).toMatchObject({
      ok: true,
      changed: true,
      snapshot: { playback: { status: "playing", revision: 2 } },
    });

    const paused = store.setPlayback(roomId, "p1", "paused");
    expect(paused).toMatchObject({
      ok: true,
      changed: true,
      snapshot: { playback: { status: "paused", revision: 3 } },
    });
  });

  it("reports no change and keeps the revision when the status is already in effect", () => {
    const { store, roomId } = roomWithMedia();
    store.setPlayback(roomId, "p1", "playing");

    expect(store.setPlayback(roomId, "p2", "playing")).toMatchObject({
      ok: true,
      changed: false,
      snapshot: { playback: { status: "playing", revision: 2 } },
    });
  });

  it("rejects playback before any media is shared", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada");

    expect(store.setPlayback(snapshot.roomId, "p1", "playing")).toEqual({
      ok: false,
      error: "no_media",
    });
    expect(store.getSnapshot(snapshot.roomId)?.playback).toEqual(initialPlayback);
  });

  it("rejects unknown rooms and non-members", () => {
    const { store, roomId } = roomWithMedia();

    expect(store.setPlayback("ZZZZZZZZ", "p1", "playing")).toEqual({
      ok: false,
      error: "room_not_found",
    });
    expect(store.setPlayback(roomId, "intruder", "playing")).toEqual({
      ok: false,
      error: "not_in_room",
    });
  });

  it("resets to paused with a new revision when the host changes media", () => {
    const { store, roomId } = roomWithMedia();
    store.setPlayback(roomId, "p2", "playing");

    const result = store.setMedia(roomId, "p1", { ...media, name: "other.mp4" });

    expect(result.ok && result.snapshot.playback).toEqual({
      status: "paused",
      revision: 3,
    });
  });

  it("keeps the playback state when the host leaves", () => {
    const { store, roomId } = roomWithMedia();
    store.setPlayback(roomId, "p1", "playing");

    expect(store.leaveRoom(roomId, "p1")?.playback).toEqual({
      status: "playing",
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
