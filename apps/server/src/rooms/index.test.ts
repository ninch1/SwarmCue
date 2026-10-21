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

describe("createRoomStore", () => {
  it("creates a room containing only the creator", () => {
    const store = createTestStore();

    const { participant, snapshot } = store.createRoom("Ada");

    expect(participant).toEqual({ id: "p1", displayName: "Ada" });
    expect(snapshot).toEqual({
      roomId: "AAAAAAAA",
      participants: [{ id: "p1", displayName: "Ada" }],
    });
  });

  it("gives joiners the same snapshot in join order", () => {
    const store = createTestStore();
    const created = store.createRoom("Ada");

    const joined = store.joinRoom(created.snapshot.roomId, "Grace");

    expect(joined).toEqual({
      ok: true,
      participant: { id: "p2", displayName: "Grace" },
      snapshot: {
        roomId: "AAAAAAAA",
        participants: [
          { id: "p1", displayName: "Ada" },
          { id: "p2", displayName: "Grace" },
        ],
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

  it("removes a leaving participant and keeps the others", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada");
    store.joinRoom(snapshot.roomId, "Grace");

    expect(store.leaveRoom(snapshot.roomId, "p1")).toEqual({
      roomId: "AAAAAAAA",
      participants: [{ id: "p2", displayName: "Grace" }],
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

describe("generateRoomId", () => {
  it("produces codes that match the protocol format", () => {
    for (let index = 0; index < 100; index += 1) {
      expect(RoomIdSchema.safeParse(generateRoomId()).success).toBe(true);
    }
  });
});
