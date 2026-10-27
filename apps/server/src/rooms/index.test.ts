import { ResumeTokenSchema, RoomIdSchema, SubtitleIdSchema } from "@swarmcue/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import {
  generateResumeToken,
  generateRoomId,
  generateSubtitleId,
  hashResumeToken,
} from "./ids.js";
import { createRoomStore } from "./index.js";

const START_MS = 1_700_000_000_000;
const GRACE_MS = 30_000;
/** Server clock shared by every test store; reset before each test. */
const clock = { nowMs: START_MS };

beforeEach(() => {
  clock.nowMs = START_MS;
});

/** The Nth generated subtitle id: 22 characters, like real ones. */
function subtitleIdOf(n: number): string {
  return `sub${n}`.padEnd(22, "x");
}

/**
 * Participants are p1, p2, … with resume tokens tok1, tok2, …. Tests use
 * connection id N for participant pN's first connection.
 */
function createTestStore(options: {
  roomIds?: string[];
  maxParticipants?: number;
} = {}) {
  const roomIds = [...(options.roomIds ?? ["AAAAAAAA", "BBBBBBBB", "CCCCCCCC"])];
  let participantCount = 0;
  let tokenCount = 0;
  let subtitleCount = 0;

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
    generateResumeToken: () => {
      tokenCount += 1;
      return `tok${tokenCount}`;
    },
    generateSubtitleId: () => {
      subtitleCount += 1;
      return subtitleIdOf(subtitleCount);
    },
    hashResumeToken: (token) => `hash:${token}`,
    maxParticipants: options.maxParticipants ?? 5,
    graceMs: GRACE_MS,
    now: () => clock.nowMs,
  });
}

/** Ada (p1, host, connection 1), Grace (p2, connection 2), Linus (p3, connection 3). */
function roomOfThree() {
  const store = createTestStore();
  const { snapshot } = store.createRoom("Ada", 1);
  store.joinRoom(snapshot.roomId, "Grace", 2);
  store.joinRoom(snapshot.roomId, "Linus", 3);
  return { store, roomId: snapshot.roomId };
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

const ada = { id: "p1", displayName: "Ada", connected: true };
const grace = { id: "p2", displayName: "Grace", connected: true };

describe("createRoomStore", () => {
  it("creates a room containing only the creator, who is host", () => {
    const store = createTestStore();

    const { participant, resumeToken, snapshot } = store.createRoom("Ada", 1);

    expect(participant).toEqual(ada);
    expect(resumeToken).toBe("tok1");
    expect(snapshot).toEqual({
      roomId: "AAAAAAAA",
      hostId: "p1",
      participants: [ada],
      media: null,
      playback: initialPlayback,
      subtitle: null,
    });
  });

  it("gives joiners the same snapshot in join order without making them host", () => {
    const store = createTestStore();
    const created = store.createRoom("Ada", 1);

    const joined = store.joinRoom(created.snapshot.roomId, "Grace", 2);

    expect(joined).toEqual({
      ok: true,
      participant: grace,
      resumeToken: "tok2",
      snapshot: {
        roomId: "AAAAAAAA",
        hostId: "p1",
        participants: [ada, grace],
        media: null,
        playback: initialPlayback,
        subtitle: null,
      },
    });
    expect(store.getSnapshot("AAAAAAAA")).toEqual(joined.ok ? joined.snapshot : null);
  });

  it("rejects joining an unknown room", () => {
    const store = createTestStore();

    expect(store.joinRoom("ZZZZZZZZ", "Grace", 2)).toEqual({
      ok: false,
      error: "room_not_found",
    });
  });

  it("rejects joining a full room, counting disconnected participants", () => {
    const store = createTestStore({ maxParticipants: 2 });
    const { snapshot } = store.createRoom("Ada", 1);
    store.joinRoom(snapshot.roomId, "Grace", 2);
    store.markDisconnected(snapshot.roomId, "p2", 2);

    expect(store.joinRoom(snapshot.roomId, "Linus", 3)).toEqual({
      ok: false,
      error: "room_full",
    });
    expect(store.getSnapshot(snapshot.roomId)?.participants).toHaveLength(2);
  });

  it("skips generated room ids that are already in use", () => {
    const store = createTestStore({ roomIds: ["AAAAAAAA", "AAAAAAAA", "BBBBBBBB"] });

    store.createRoom("Ada", 1);
    const second = store.createRoom("Grace", 2);

    expect(second.snapshot.roomId).toBe("BBBBBBBB");
  });

  it("does not expose internal state through returned snapshots", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada", 1);

    snapshot.participants.push({ id: "intruder", displayName: "Eve", connected: true });

    expect(store.getSnapshot(snapshot.roomId)?.participants).toHaveLength(1);
  });

  it("never puts resume tokens or their hashes in snapshots", () => {
    const { store, roomId } = roomOfThree();
    store.markDisconnected(roomId, "p2", 2);

    const serialized = JSON.stringify(store.getSnapshot(roomId));

    expect(serialized).not.toMatch(/tok\d/);
    expect(serialized).not.toContain("hash:");
  });
});

describe("leave", () => {
  it("removes a non-host immediately and keeps the host", () => {
    const { store, roomId } = roomOfThree();

    const result = store.leave(roomId, "p2", 2);

    expect(result.ok && result.snapshot).toMatchObject({
      hostId: "p1",
      participants: [{ id: "p1" }, { id: "p3" }],
    });
  });

  it("transfers host immediately to the earliest-joined connected participant", () => {
    const { store, roomId } = roomOfThree();
    store.markDisconnected(roomId, "p2", 2);

    const result = store.leave(roomId, "p1", 1);

    expect(result.ok && result.snapshot?.hostId).toBe("p3");
  });

  it("deletes the room when the last participant leaves", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada", 1);

    expect(store.leave(snapshot.roomId, "p1", 1)).toEqual({ ok: true, snapshot: null });
    expect(store.getSnapshot(snapshot.roomId)).toBeNull();
    expect(store.joinRoom(snapshot.roomId, "Grace", 2)).toEqual({
      ok: false,
      error: "room_not_found",
    });
  });

  it("ignores a leave from a connection that is not the participant's current one", () => {
    const { store, roomId } = roomOfThree();
    store.resume(roomId, "tok2", 20);

    expect(store.leave(roomId, "p2", 2)).toEqual({ ok: false });
    expect(store.getSnapshot(roomId)?.participants).toHaveLength(3);
  });
});

describe("disconnect and grace period", () => {
  it("keeps a disconnected participant in the room, marked not connected", () => {
    const { store, roomId } = roomOfThree();

    const result = store.markDisconnected(roomId, "p2", 2);

    expect(result).toMatchObject({
      changed: true,
      expiresAtMs: START_MS + GRACE_MS,
      snapshot: {
        participants: [
          { id: "p1", connected: true },
          { id: "p2", connected: false },
          { id: "p3", connected: true },
        ],
      },
    });
  });

  it("reports repeated disconnects only once, so no duplicate removal is scheduled", () => {
    const { store, roomId } = roomOfThree();
    store.markDisconnected(roomId, "p2", 2);
    clock.nowMs += 5000;

    expect(store.markDisconnected(roomId, "p2", 2)).toEqual({ changed: false });
  });

  it("does not transfer host while the host is within the grace period", () => {
    const { store, roomId } = roomOfThree();
    store.markDisconnected(roomId, "p1", 1);
    clock.nowMs += GRACE_MS - 1;

    expect(store.expireDue()).toEqual([]);
    expect(store.getSnapshot(roomId)?.hostId).toBe("p1");
  });

  it("removes a non-host once the grace period ends", () => {
    const { store, roomId } = roomOfThree();
    store.markDisconnected(roomId, "p2", 2);
    clock.nowMs += GRACE_MS;

    expect(store.expireDue()).toEqual([
      {
        roomId,
        snapshot: expect.objectContaining({
          hostId: "p1",
          participants: [
            expect.objectContaining({ id: "p1" }),
            expect.objectContaining({ id: "p3" }),
          ],
        }),
      },
    ]);
  });

  it("transfers host exactly once after the host's grace period, to the earliest connected participant", () => {
    const { store, roomId } = roomOfThree();
    // Grace (earlier-joined) is also away, so Linus is the earliest connected one.
    store.markDisconnected(roomId, "p2", 2);
    clock.nowMs += 1000;
    store.markDisconnected(roomId, "p1", 1);
    clock.nowMs += GRACE_MS - 1000;

    // Grace's deadline has passed; Ada's is 1 s away.
    const first = store.expireDue();
    expect(first).toHaveLength(1);
    expect(first[0]?.snapshot?.hostId).toBe("p1");

    clock.nowMs += 1000;
    const second = store.expireDue();
    expect(second[0]?.snapshot).toMatchObject({
      hostId: "p3",
      participants: [{ id: "p3", connected: true }],
    });

    // A late or duplicate wake-up changes nothing.
    expect(store.expireDue()).toEqual([]);
  });

  it("falls back to the earliest-joined remaining participant when nobody is connected", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada", 1);
    store.joinRoom(snapshot.roomId, "Grace", 2);
    store.markDisconnected(snapshot.roomId, "p1", 1);
    clock.nowMs += 1000;
    store.markDisconnected(snapshot.roomId, "p2", 2);
    clock.nowMs += GRACE_MS - 1000;

    const [expired] = store.expireDue();

    expect(expired?.snapshot).toMatchObject({
      hostId: "p2",
      participants: [{ id: "p2", connected: false }],
    });
  });

  it("deletes the room after every participant expires", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada", 1);
    store.joinRoom(snapshot.roomId, "Grace", 2);
    store.markDisconnected(snapshot.roomId, "p1", 1);
    store.markDisconnected(snapshot.roomId, "p2", 2);
    clock.nowMs += GRACE_MS;

    expect(store.expireDue()).toEqual([{ roomId: snapshot.roomId, snapshot: null }]);
    expect(store.getSnapshot(snapshot.roomId)).toBeNull();
  });

  it("ignores a disconnect from a connection the participant no longer uses", () => {
    const { store, roomId } = roomOfThree();
    store.resume(roomId, "tok2", 20);

    // The replaced socket closes after the new one took over.
    expect(store.markDisconnected(roomId, "p2", 2)).toEqual({ changed: false });
    expect(store.getSnapshot(roomId)?.participants[1]).toEqual(grace);
  });
});

describe("resume", () => {
  it("restores the same participant and host role within the grace period", () => {
    const { store, roomId } = roomOfThree();
    store.markDisconnected(roomId, "p1", 1);
    clock.nowMs += 10_000;

    const result = store.resume(roomId, "tok1", 10);

    expect(result).toMatchObject({
      ok: true,
      participantId: "p1",
      replacedConnectionId: null,
      changed: true,
      snapshot: { hostId: "p1" },
    });
    const participants = store.getSnapshot(roomId)?.participants ?? [];
    expect(participants).toHaveLength(3);
    expect(participants.filter((p) => p.id === "p1")).toEqual([ada]);
    // The old deadline no longer applies.
    clock.nowMs += GRACE_MS;
    expect(store.expireDue()).toEqual([]);
  });

  it("succeeds one millisecond before the deadline, and the later wake-up does nothing", () => {
    const { store, roomId } = roomOfThree();
    store.markDisconnected(roomId, "p2", 2);
    clock.nowMs = START_MS + GRACE_MS - 1;

    expect(store.resume(roomId, "tok2", 20).ok).toBe(true);

    clock.nowMs = START_MS + GRACE_MS;
    expect(store.expireDue()).toEqual([]);
    expect(store.getSnapshot(roomId)?.participants).toHaveLength(3);
  });

  it("is rejected at the deadline, before the wake-up has removed the participant", () => {
    const { store, roomId } = roomOfThree();
    store.markDisconnected(roomId, "p2", 2);
    clock.nowMs = START_MS + GRACE_MS;

    expect(store.resume(roomId, "tok2", 20)).toEqual({
      ok: false,
      error: "resume_rejected",
    });
    expect(store.expireDue()).toHaveLength(1);
  });

  it("is rejected after the participant has expired", () => {
    const { store, roomId } = roomOfThree();
    store.markDisconnected(roomId, "p2", 2);
    clock.nowMs += GRACE_MS;
    store.expireDue();

    expect(store.resume(roomId, "tok2", 20)).toEqual({
      ok: false,
      error: "resume_rejected",
    });
  });

  it.each([
    ["wrong token", "AAAAAAAA", "tok9"],
    ["another room's code", "ZZZZZZZZ", "tok2"],
    ["participant id instead of token", "AAAAAAAA", "p2"],
  ])("rejects a %s", (_label, roomId, token) => {
    const { store } = roomOfThree();
    store.markDisconnected("AAAAAAAA", "p2", 2);

    expect(store.resume(roomId, token, 20)).toEqual({
      ok: false,
      error: "resume_rejected",
    });
  });

  it("lets a newer connection take over a still-connected session", () => {
    const { store, roomId } = roomOfThree();

    expect(store.resume(roomId, "tok2", 20)).toMatchObject({
      ok: true,
      participantId: "p2",
      replacedConnectionId: 2,
      changed: false,
    });
    // The newest connection wins again if a third one resumes.
    expect(store.resume(roomId, "tok2", 21)).toMatchObject({ replacedConnectionId: 20 });
    expect(store.getSnapshot(roomId)?.participants).toHaveLength(3);
  });
});

describe("setMedia", () => {
  it("lets the host set media and returns the updated snapshot", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada", 1);
    store.joinRoom(snapshot.roomId, "Grace", 2);

    const result = store.setMedia(snapshot.roomId, "p1", media);

    expect(result).toEqual({
      ok: true,
      snapshot: {
        roomId: "AAAAAAAA",
        hostId: "p1",
        participants: [ada, grace],
        media,
        playback: { ...initialPlayback, revision: 1 },
        subtitle: null,
      },
    });
    expect(store.getSnapshot(snapshot.roomId)?.media).toEqual(media);
  });

  it("rejects a non-host and leaves the state unchanged", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada", 1);
    store.joinRoom(snapshot.roomId, "Grace", 2);

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
    const { snapshot } = store.createRoom("Ada", 1);
    store.joinRoom(snapshot.roomId, "Grace", 2);
    store.setMedia(snapshot.roomId, "p1", media);

    const afterLeave = store.leave(snapshot.roomId, "p1", 1);
    expect(afterLeave.ok && afterLeave.snapshot?.media).toEqual(media);

    const replacement = { ...media, name: "other.mp4" };
    expect(store.setMedia(snapshot.roomId, "p2", replacement).ok).toBe(true);
    expect(store.getSnapshot(snapshot.roomId)?.media).toEqual(replacement);
  });

  it("does not expose stored media through snapshots or the caller's object", () => {
    const store = createTestStore();
    const { snapshot } = store.createRoom("Ada", 1);
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
    const { snapshot } = store.createRoom("Ada", 1);
    store.joinRoom(snapshot.roomId, "Grace", 2);
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
    const { snapshot } = store.createRoom("Ada", 1);

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

  it("keeps the playback timeline through a disconnect, resume, and host transfer", () => {
    const { store, roomId } = roomWithMedia();
    store.setPlayback(roomId, "p1", play(12));
    const timeline = store.getSnapshot(roomId)?.playback;

    store.markDisconnected(roomId, "p1", 1);
    clock.nowMs += 5000;
    expect(store.resume(roomId, "tok1", 10)).toMatchObject({
      ok: true,
      snapshot: { playback: timeline },
    });

    expect(store.leave(roomId, "p1", 10)).toMatchObject({
      ok: true,
      snapshot: { hostId: "p2", playback: timeline },
    });
  });
});

describe("shared subtitle", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHéllo\n";
  const request = { name: "movie.en.srt", content: vtt, mediaMagnetUri: media.magnetUri };

  function roomWithMedia() {
    const { store, roomId } = roomOfThree();
    store.setMedia(roomId, "p1", media);
    return { store, roomId };
  }

  it("lets any participant share a subtitle, exposing only metadata in snapshots", () => {
    const { store, roomId } = roomWithMedia();

    const result = store.setSubtitle(roomId, "p2", request);

    const metadata = {
      id: subtitleIdOf(1),
      name: "movie.en.srt",
      // "é" is two bytes in UTF-8.
      sizeBytes: vtt.length + 1,
      sharedBy: "p2",
    };
    expect(result).toEqual({
      ok: true,
      snapshot: expect.objectContaining({ subtitle: metadata }),
      delivery: { id: subtitleIdOf(1), content: vtt },
    });
    expect(store.getSnapshot(roomId)?.subtitle).toEqual(metadata);
    expect(JSON.stringify(store.getSnapshot(roomId))).not.toContain("Héllo");
    expect(store.getSubtitleDelivery(roomId)).toEqual({ id: subtitleIdOf(1), content: vtt });
  });

  it("replaces the subtitle with a new id every time, last write wins", () => {
    const { store, roomId } = roomWithMedia();
    store.setSubtitle(roomId, "p2", request);

    const second = store.setSubtitle(roomId, "p3", { ...request, name: "other.vtt" });
    const third = store.setSubtitle(roomId, "p3", { ...request, name: "other.vtt" });

    expect(second.ok && second.delivery.id).toBe(subtitleIdOf(2));
    expect(third.ok && third.delivery.id).toBe(subtitleIdOf(3));
    expect(store.getSnapshot(roomId)?.subtitle).toMatchObject({
      id: subtitleIdOf(3),
      name: "other.vtt",
      sharedBy: "p3",
    });
  });

  it("rejects a subtitle when nothing is playing", () => {
    const { store, roomId } = roomOfThree();

    expect(store.setSubtitle(roomId, "p1", request)).toEqual({ ok: false, error: "no_media" });
    expect(store.getSnapshot(roomId)?.subtitle).toBeNull();
  });

  it("rejects a subtitle chosen for media that has since been replaced", () => {
    const { store, roomId } = roomWithMedia();
    store.setMedia(roomId, "p1", {
      ...media,
      magnetUri: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
    });

    expect(store.setSubtitle(roomId, "p2", request)).toEqual({
      ok: false,
      error: "media_changed",
    });
    expect(store.getSubtitleDelivery(roomId)).toBeNull();
  });

  it("rejects senders who are not in the room, and unknown rooms", () => {
    const { store, roomId } = roomWithMedia();

    expect(store.setSubtitle(roomId, "intruder", request)).toEqual({
      ok: false,
      error: "not_in_room",
    });
    expect(store.setSubtitle("ZZZZZZZZ", "p1", request)).toEqual({
      ok: false,
      error: "room_not_found",
    });
    expect(store.removeSubtitle(roomId, "intruder", subtitleIdOf(1))).toEqual({
      ok: false,
      error: "not_in_room",
    });
  });

  it("removes the subtitle it was asked to remove", () => {
    const { store, roomId } = roomWithMedia();
    store.setSubtitle(roomId, "p2", request);

    const result = store.removeSubtitle(roomId, "p3", subtitleIdOf(1));

    expect(result).toEqual({
      ok: true,
      changed: true,
      snapshot: expect.objectContaining({ subtitle: null }),
    });
    expect(store.getSubtitleDelivery(roomId)).toBeNull();
  });

  it("does nothing when removing a subtitle that was already replaced or removed", () => {
    const { store, roomId } = roomWithMedia();
    store.setSubtitle(roomId, "p2", request);
    store.setSubtitle(roomId, "p3", request);

    expect(store.removeSubtitle(roomId, "p1", subtitleIdOf(1))).toEqual({
      ok: true,
      changed: false,
    });
    expect(store.getSnapshot(roomId)?.subtitle?.id).toBe(subtitleIdOf(2));

    store.removeSubtitle(roomId, "p1", subtitleIdOf(2));
    expect(store.removeSubtitle(roomId, "p1", subtitleIdOf(2))).toEqual({
      ok: true,
      changed: false,
    });
  });

  it("clears the subtitle when new media is shared", () => {
    const { store, roomId } = roomWithMedia();
    store.setSubtitle(roomId, "p2", request);

    const result = store.setMedia(roomId, "p1", { ...media, name: "other.mp4" });

    expect(result.ok && result.snapshot.subtitle).toBeNull();
    expect(store.getSubtitleDelivery(roomId)).toBeNull();
  });

  it("keeps the subtitle through disconnects, resumes, leaving and host transfer", () => {
    const { store, roomId } = roomWithMedia();
    store.setSubtitle(roomId, "p2", request);

    store.markDisconnected(roomId, "p2", 2);
    store.resume(roomId, "tok2", 20);
    store.markDisconnected(roomId, "p3", 3);
    clock.nowMs += GRACE_MS;
    store.expireDue();
    const left = store.leave(roomId, "p1", 1);

    expect(left.ok && left.snapshot).toMatchObject({
      hostId: "p2",
      subtitle: { id: subtitleIdOf(1), sharedBy: "p2" },
    });
    expect(store.getSubtitleDelivery(roomId)?.id).toBe(subtitleIdOf(1));
  });

  it("disappears with the room", () => {
    const { store, roomId } = roomWithMedia();
    store.setSubtitle(roomId, "p2", request);

    store.leave(roomId, "p1", 1);
    store.leave(roomId, "p2", 2);
    store.leave(roomId, "p3", 3);

    expect(store.getSubtitleDelivery(roomId)).toBeNull();
    expect(store.getSnapshot(roomId)).toBeNull();
  });
});

describe("ids", () => {
  it("generates unique subtitle ids that match the protocol format", () => {
    const ids = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      const id = generateSubtitleId();
      expect(SubtitleIdSchema.safeParse(id).success).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(100);
  });

  it("generates room codes that match the protocol format", () => {
    for (let index = 0; index < 100; index += 1) {
      expect(RoomIdSchema.safeParse(generateRoomId()).success).toBe(true);
    }
  });

  it("generates unique resume tokens that match the protocol format", () => {
    const tokens = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      const token = generateResumeToken();
      expect(ResumeTokenSchema.safeParse(token).success).toBe(true);
      tokens.add(token);
    }
    expect(tokens.size).toBe(100);
  });

  it("hashes tokens deterministically without revealing them", () => {
    const token = generateResumeToken();

    expect(hashResumeToken(token)).toBe(hashResumeToken(token));
    expect(hashResumeToken(token)).not.toContain(token);
    expect(hashResumeToken(token)).not.toBe(hashResumeToken(generateResumeToken()));
  });
});
