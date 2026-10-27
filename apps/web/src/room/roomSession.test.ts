import {
  ProtocolVersion,
  type ClientMessage,
  type RoomSnapshot,
  type ServerMessage,
} from "@swarmcue/protocol";
import { describe, expect, it, vi } from "vitest";
import type { ClockSample } from "../clock/clockEstimate.js";
import type { ClockSync, ClockSyncOptions } from "../clock/clockSync.js";
import type { RoomConnectionHandlers } from "./connection.js";
import { RECONNECT_GIVE_UP_AFTER_MS } from "./reconnectBackoff.js";
import { createRoomSession, type RoomState } from "./roomSession.js";
import { createSessionStore, SESSION_STORAGE_KEY } from "./sessionStore.js";

const ROOM_ID = "K7QM3XPD";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomId: ROOM_ID,
    hostId: "p1",
    participants: [{ id: "p1", displayName: "Ada", connected: true }],
    media: null,
    playback: { status: "paused", positionSeconds: 0, updatedAtServerMs: 1, revision: 0 },
    subtitle: null,
    ...overrides,
  };
}

type FakeConnection = {
  handlers: RoomConnectionHandlers;
  sent: ClientMessage[];
  closed: boolean;
  open: () => void;
  receive: (message: ServerMessage) => void;
  drop: (code?: number) => void;
};

type FakeClock = ClockSync & { options: ClockSyncOptions; disposed: boolean; sample: ClockSample | null };

function setup({ stored = false, random = () => 1 } = {}) {
  const items = new Map<string, string>();
  const storage = {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
  if (stored) {
    items.set(SESSION_STORAGE_KEY, JSON.stringify({ v: 1, roomId: ROOM_ID, resumeToken: TOKEN }));
  }

  let monotonicMs = 0;
  const timers: { callback: () => void; atMs: number; cleared: boolean; delayMs: number }[] = [];
  const connections: FakeConnection[] = [];
  const clocks: FakeClock[] = [];
  const states: RoomState[] = [];

  const room = createRoomSession({
    openConnection: (handlers) => {
      const connection: FakeConnection = {
        handlers,
        sent: [],
        closed: false,
        open: () => handlers.onOpen(),
        receive: (message) => handlers.onMessage(message),
        drop: (code = 1006) => handlers.onClose(code),
      };
      connections.push(connection);
      return {
        send: (message) => connection.sent.push(message),
        close: () => {
          connection.closed = true;
        },
      };
    },
    startClockSync: (options) => {
      const clock: FakeClock = {
        options,
        disposed: false,
        sample: options.initialEstimate ?? null,
        handlePong: vi.fn(),
        estimateServerNowMs: () =>
          clock.sample ? monotonicMs + clock.sample.monotonicToServerOffsetMs : null,
        currentSample: () => clock.sample,
        resyncNow: vi.fn(),
        dispose: () => {
          clock.disposed = true;
        },
      };
      clocks.push(clock);
      return clock;
    },
    sessionStore: createSessionStore(storage),
    onStateChange: (state) => states.push(state),
    setTimer: (callback, delayMs) => {
      const timer = { callback, atMs: monotonicMs + delayMs, cleared: false, delayMs };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    random,
    monotonicNow: () => monotonicMs,
  });

  return {
    room,
    storage,
    connections,
    clocks,
    states,
    last: () => {
      const connection = connections.at(-1);
      if (!connection) throw new Error("no connection opened");
      return connection;
    },
    pendingTimers: () => timers.filter((timer) => !timer.cleared),
    /** Advance the monotonic clock and fire due timers. */
    advance(ms: number) {
      monotonicMs += ms;
      for (const timer of [...timers]) {
        if (!timer.cleared && timer.atMs <= monotonicMs) {
          timer.cleared = true;
          timer.callback();
        }
      }
    },
  };
}

/** Create a room and get the joined confirmation. */
function joined(options?: Parameters<typeof setup>[0]) {
  const harness = setup(options);
  harness.room.createRoom("Ada");
  harness.last().open();
  harness.last().receive({
    type: "room.joined",
    selfId: "p1",
    resumeToken: TOKEN,
    snapshot: snapshot(),
  });
  return harness;
}

const resumeMessage = {
  type: "room.resume",
  protocolVersion: ProtocolVersion,
  roomId: ROOM_ID,
  resumeToken: TOKEN,
};

describe("createRoomSession", () => {
  it("stores only the room id and token once the room is joined", () => {
    const { room, storage, clocks } = joined();

    expect(room.getState()).toMatchObject({
      status: "in-room",
      connection: "connected",
      selfId: "p1",
      resyncKey: 1,
    });
    expect(JSON.parse(storage.items.get(SESSION_STORAGE_KEY) ?? "")).toEqual({
      v: 1,
      roomId: ROOM_ID,
      resumeToken: TOKEN,
    });
    expect(clocks).toHaveLength(1);
  });

  it("keeps the room visible while reconnecting, then resumes with a fresh clock session", () => {
    const harness = joined();
    harness.clocks[0]!.sample = { roundTripMs: 20, monotonicToServerOffsetMs: 7000 };

    harness.last().drop();

    expect(harness.room.getState()).toMatchObject({
      status: "in-room",
      connection: "reconnecting",
      snapshot: snapshot(),
    });
    expect(harness.clocks[0]!.disposed).toBe(true);
    // The previous estimate stays available while disconnected.
    expect(harness.room.estimateServerNowMs()).toBe(7000);

    harness.advance(500);
    const second = harness.last();
    expect(harness.connections).toHaveLength(2);
    second.open();
    expect(second.sent[0]).toEqual(resumeMessage);
    expect(harness.clocks[1]!.options.initialEstimate).toEqual({
      roundTripMs: 20,
      monotonicToServerOffsetMs: 7000,
    });

    const fresh = snapshot({ playback: { status: "playing", positionSeconds: 12, updatedAtServerMs: 5, revision: 4 } });
    second.receive({ type: "room.resumed", selfId: "p1", snapshot: fresh });

    expect(harness.room.getState()).toEqual({
      status: "in-room",
      connection: "connected",
      selfId: "p1",
      snapshot: fresh,
      resyncKey: 2,
      error: null,
      sharedSubtitle: null,
      subtitleShare: { status: "idle" },
    });
  });

  it("backs off exponentially between failed attempts and gives up after the window", () => {
    const harness = joined();
    harness.last().drop();

    const delays: number[] = [];
    let elapsed = 0;
    while (harness.room.getState().status === "in-room") {
      const timer = harness.pendingTimers().at(-1);
      if (!timer) break;
      delays.push(timer.delayMs);
      harness.advance(timer.delayMs);
      elapsed += timer.delayMs;
      harness.last().drop(); // the attempt fails before resuming
    }

    expect(delays.slice(0, 6)).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
    expect(elapsed).toBeGreaterThanOrEqual(RECONNECT_GIVE_UP_AFTER_MS - 5000);
    expect(harness.room.getState()).toEqual({
      status: "idle",
      error: "Couldn't reconnect to the room.",
    });
    expect(harness.storage.items.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(harness.pendingTimers()).toHaveLength(0);
  });

  it("skips the remaining backoff when asked to reconnect now", () => {
    const harness = joined();
    harness.last().drop();

    harness.room.reconnectNow();

    expect(harness.connections).toHaveLength(2);
    expect(harness.pendingTimers()).toHaveLength(0);
  });

  it("ends the session and forgets it when the server rejects the resume", () => {
    const harness = joined();
    harness.last().drop();
    harness.advance(500);
    harness.last().open();

    harness.last().receive({ type: "error", code: "resume_rejected", message: "x" });

    expect(harness.room.getState()).toEqual({
      status: "idle",
      error: "This room session has ended.",
    });
    expect(harness.storage.items.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(harness.pendingTimers()).toHaveLength(0);
  });

  it("keeps the stored session when the server speaks a newer protocol", () => {
    const harness = joined();
    harness.last().drop();
    harness.advance(500);
    harness.last().open();

    harness.last().receive({ type: "error", code: "unsupported_version", message: "x" });

    expect(harness.room.getState()).toMatchObject({ status: "idle" });
    expect(harness.storage.items.has(SESSION_STORAGE_KEY)).toBe(true);
    expect(harness.pendingTimers()).toHaveLength(0);
  });

  it.each([
    ["an error message", (c: FakeConnection) => c.receive({ type: "error", code: "session_replaced", message: "x" })],
    ["the close code alone", (c: FakeConnection) => c.drop(4000)],
  ])("stops for good when replaced by another tab (%s)", (_label, replace) => {
    const harness = joined();

    replace(harness.last());

    expect(harness.room.getState()).toEqual({
      status: "idle",
      error: "This room was opened in another tab or window.",
    });
    expect(harness.storage.items.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(harness.pendingTimers()).toHaveLength(0);
    harness.advance(RECONNECT_GIVE_UP_AFTER_MS);
    expect(harness.connections).toHaveLength(1);
  });

  it("tells the server when leaving and forgets the session", () => {
    const harness = joined();
    const connection = harness.last();

    harness.room.leave();

    expect(connection.sent.at(-1)).toEqual({ type: "room.leave", protocolVersion: ProtocolVersion });
    expect(connection.closed).toBe(true);
    expect(harness.room.getState()).toEqual({ status: "idle", error: null });
    expect(harness.storage.items.has(SESSION_STORAGE_KEY)).toBe(false);
  });

  it("cancels a pending reconnect when leaving", () => {
    const harness = joined();
    harness.last().drop();

    harness.room.leave();
    harness.advance(10_000);

    expect(harness.connections).toHaveLength(1);
    expect(harness.storage.items.has(SESSION_STORAGE_KEY)).toBe(false);
  });

  it("cancels a pending reconnect on dispose but keeps the stored session for a refresh", () => {
    const harness = joined();
    harness.last().drop();

    harness.room.dispose();
    harness.advance(10_000);

    expect(harness.connections).toHaveLength(1);
    expect(harness.storage.items.has(SESSION_STORAGE_KEY)).toBe(true);
  });

  it("resumes the stored session after a page load", () => {
    const harness = setup({ stored: true });

    expect(harness.room.resumeStored()).toBe(true);
    expect(harness.room.getState()).toEqual({ status: "resuming" });
    harness.last().open();
    expect(harness.last().sent[0]).toEqual(resumeMessage);

    harness.last().receive({ type: "room.resumed", selfId: "p1", snapshot: snapshot() });
    expect(harness.room.getState()).toMatchObject({ status: "in-room", connection: "connected" });
  });

  it("reports that there is nothing to resume without a stored session", () => {
    const harness = setup();

    expect(harness.room.resumeStored()).toBe(false);
    expect(harness.connections).toHaveLength(0);
  });

  it("refuses room commands while reconnecting", () => {
    const harness = joined();
    harness.last().drop();

    expect(harness.room.setPlayback("playing", 3)).toBe("Reconnecting to the room…");
    expect(harness.room.setMedia({ magnetUri: "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056", name: null, sizeBytes: null })).toBe(
      "Reconnecting to the room…",
    );
  });

  it("ignores events from a connection that has been replaced", () => {
    const harness = joined();
    const first = harness.last();
    first.drop();
    harness.advance(500);

    // Late events from the first connection change nothing.
    first.receive({ type: "room.snapshot", snapshot: snapshot({ hostId: "p1", media: null }) });
    first.drop();

    expect(harness.connections).toHaveLength(2);
    expect(harness.room.getState()).toMatchObject({ connection: "reconnecting" });
  });

  describe("shared subtitle", () => {
    const MAGNET = "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056";
    const media = { magnetUri: MAGNET, name: "movie.mp4", sizeBytes: 1024 };
    const idA = "AAAAAAAAAAAAAAAAAAAAAA";
    const idB = "BBBBBBBBBBBBBBBBBBBBBB";
    const vttA = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n";
    const vttB = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nB\n";

    function metadata(id: string, sharedBy = "p2") {
      return { id, name: `${id.slice(0, 1)}.srt`, sizeBytes: 40, sharedBy };
    }

    function withSubtitle(id: string | null, sharedBy?: string) {
      return snapshot({ media, subtitle: id ? metadata(id, sharedBy) : null });
    }

    function inRoom() {
      const harness = joined();
      harness.last().receive({ type: "room.snapshot", snapshot: withSubtitle(null) });
      return harness;
    }

    const stateOf = (harness: ReturnType<typeof setup>) => {
      const state = harness.room.getState();
      if (state.status !== "in-room") throw new Error("not in room");
      return state;
    };

    it("keeps content whose id matches the snapshot", () => {
      const harness = inRoom();

      harness.last().receive({ type: "room.snapshot", snapshot: withSubtitle(idA) });
      harness.last().receive({ type: "subtitle.content", id: idA, content: vttA });

      expect(stateOf(harness).sharedSubtitle).toEqual({ id: idA, vtt: vttA });
    });

    it("ignores content that the snapshot does not name (stale or early)", () => {
      const harness = inRoom();
      harness.last().receive({ type: "room.snapshot", snapshot: withSubtitle(idB) });

      harness.last().receive({ type: "subtitle.content", id: idA, content: vttA });

      expect(stateOf(harness).sharedSubtitle).toBeNull();
    });

    it("drops content when the snapshot replaces or removes the subtitle", () => {
      const harness = inRoom();
      harness.last().receive({ type: "room.snapshot", snapshot: withSubtitle(idA) });
      harness.last().receive({ type: "subtitle.content", id: idA, content: vttA });

      harness.last().receive({ type: "room.snapshot", snapshot: withSubtitle(idB) });
      expect(stateOf(harness).sharedSubtitle).toBeNull();
      // A late copy of the replaced subtitle cannot restore it.
      harness.last().receive({ type: "subtitle.content", id: idA, content: vttA });
      expect(stateOf(harness).sharedSubtitle).toBeNull();
      harness.last().receive({ type: "subtitle.content", id: idB, content: vttB });
      expect(stateOf(harness).sharedSubtitle).toEqual({ id: idB, vtt: vttB });

      harness.last().receive({ type: "room.snapshot", snapshot: withSubtitle(null) });
      expect(stateOf(harness).sharedSubtitle).toBeNull();
    });

    it("keeps the same content object through unrelated snapshots and repeats", () => {
      const harness = inRoom();
      harness.last().receive({ type: "room.snapshot", snapshot: withSubtitle(idA) });
      harness.last().receive({ type: "subtitle.content", id: idA, content: vttA });
      const held = stateOf(harness).sharedSubtitle;
      const states = harness.states.length;

      harness.last().receive({ type: "subtitle.content", id: idA, content: vttA });
      expect(harness.states).toHaveLength(states);
      harness.last().receive({
        type: "room.snapshot",
        snapshot: { ...withSubtitle(idA), playback: { status: "playing", positionSeconds: 1, updatedAtServerMs: 2, revision: 1 } },
      });
      expect(stateOf(harness).sharedSubtitle).toBe(held);
    });

    it("keeps matching content across a resume and ignores the redelivery", () => {
      const harness = inRoom();
      harness.last().receive({ type: "room.snapshot", snapshot: withSubtitle(idA) });
      harness.last().receive({ type: "subtitle.content", id: idA, content: vttA });
      const held = stateOf(harness).sharedSubtitle;

      harness.last().drop();
      harness.advance(500);
      harness.last().open();
      harness.last().receive({ type: "room.resumed", selfId: "p1", snapshot: withSubtitle(idA) });
      harness.last().receive({ type: "subtitle.content", id: idA, content: vttA });

      expect(stateOf(harness).sharedSubtitle).toBe(held);
    });

    it("drops content removed while reconnecting, and ignores the old connection", () => {
      const harness = inRoom();
      harness.last().receive({ type: "room.snapshot", snapshot: withSubtitle(idA) });
      harness.last().receive({ type: "subtitle.content", id: idA, content: vttA });
      const old = harness.last();

      old.drop();
      harness.advance(500);
      harness.last().open();
      harness.last().receive({ type: "room.resumed", selfId: "p1", snapshot: withSubtitle(null) });
      old.receive({ type: "room.snapshot", snapshot: withSubtitle(idA) });
      old.receive({ type: "subtitle.content", id: idA, content: vttA });

      expect(stateOf(harness).sharedSubtitle).toBeNull();
      expect(stateOf(harness).snapshot.subtitle).toBeNull();
    });

    it("sends subtitle.set and subtitle.remove", () => {
      const harness = inRoom();

      expect(
        harness.room.setSubtitle({ name: "a.srt", content: vttA, mediaMagnetUri: MAGNET }),
      ).toBeNull();
      expect(harness.room.removeSubtitle(idA)).toBeNull();

      expect(harness.last().sent.slice(-2)).toEqual([
        {
          type: "subtitle.set",
          protocolVersion: ProtocolVersion,
          name: "a.srt",
          content: vttA,
          mediaMagnetUri: MAGNET,
        },
        { type: "subtitle.remove", protocolVersion: ProtocolVersion, id: idA },
      ]);
    });

    it("tracks this tab's share until the server confirms it", () => {
      const harness = inRoom();

      harness.room.setSubtitle({ name: "a.srt", content: vttA, mediaMagnetUri: MAGNET });
      expect(stateOf(harness).subtitleShare).toEqual({ status: "sending" });

      // Someone else's subtitle is not a confirmation of ours.
      harness.last().receive({ type: "room.snapshot", snapshot: withSubtitle(idB, "p2") });
      expect(stateOf(harness).subtitleShare).toEqual({ status: "sending" });

      harness.last().receive({ type: "room.snapshot", snapshot: withSubtitle(idA, "p1") });
      expect(stateOf(harness).subtitleShare).toEqual({ status: "idle" });
    });

    it("reports a server rejection of the share without a general room error", () => {
      const harness = inRoom();
      harness.room.setSubtitle({ name: "a.srt", content: vttA, mediaMagnetUri: MAGNET });

      harness.last().receive({ type: "error", code: "media_changed", message: "The video changed." });

      expect(stateOf(harness)).toMatchObject({
        subtitleShare: { status: "failed", message: "The video changed." },
        error: null,
      });
    });

    it("reports invalid content locally without sending it", () => {
      const harness = inRoom();
      const sent = harness.last().sent.length;

      const error = harness.room.setSubtitle({
        name: "a.srt",
        content: "not webvtt",
        mediaMagnetUri: MAGNET,
      });

      expect(error).toBe("Shared subtitles must be WebVTT.");
      expect(harness.last().sent).toHaveLength(sent);
      expect(stateOf(harness).subtitleShare).toEqual({ status: "failed", message: error });
    });

    it("marks a share interrupted by a reconnect as failed unless it arrived", () => {
      const harness = inRoom();
      harness.room.setSubtitle({ name: "a.srt", content: vttA, mediaMagnetUri: MAGNET });

      harness.last().drop();
      harness.advance(500);
      harness.last().open();
      harness.last().receive({ type: "room.resumed", selfId: "p1", snapshot: withSubtitle(null) });

      expect(stateOf(harness).subtitleShare).toEqual({
        status: "failed",
        message: "The connection dropped before the subtitle was shared.",
      });
    });

    it("clears a failed share when the media changes", () => {
      const harness = inRoom();
      harness.room.setSubtitle({ name: "a.srt", content: vttA, mediaMagnetUri: MAGNET });
      harness.last().receive({ type: "error", code: "media_changed", message: "x" });

      harness.last().receive({
        type: "room.snapshot",
        snapshot: snapshot({
          media: { ...media, magnetUri: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000" },
        }),
      });

      expect(stateOf(harness).subtitleShare).toEqual({ status: "idle" });
    });
  });

  it("returns to the entry screen if creating a room fails", () => {
    const harness = setup();
    harness.room.joinRoom("ZZZZ-ZZZZ", "Grace");
    harness.last().open();

    harness.last().receive({ type: "error", code: "room_not_found", message: "No room." });

    expect(harness.room.getState()).toEqual({ status: "idle", error: "No room." });
    expect(harness.pendingTimers()).toHaveLength(0);
  });
});
