import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startClockSync, type ClockSyncOptions } from "./clockSync.js";

const TIMEOUT_MS = 2000;
const RESYNC_MS = 45_000;

/** A manual monotonic clock kept in step with Vitest's fake timers. */
function setup(overrides: Partial<ClockSyncOptions> = {}) {
  let nowMs = 0;
  const sent: number[] = [];
  const sync = startClockSync({
    sendPing: (id) => sent.push(id),
    monotonicNow: () => nowMs,
    samplesPerRound: 3,
    sampleTimeoutMs: TIMEOUT_MS,
    resyncIntervalMs: RESYNC_MS,
    ...overrides,
  });

  return {
    sync,
    sent,
    advance(ms: number) {
      nowMs += ms;
      vi.advanceTimersByTime(ms);
    },
    /** Reply to the most recent ping after `rttMs`, reporting `serverTimeMs`. */
    reply(rttMs: number, serverTimeMs: number) {
      nowMs += rttMs;
      const id = sent.at(-1);
      if (id === undefined) throw new Error("no ping sent");
      sync.handlePong({ id, serverTimeMs });
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startClockSync", () => {
  it("sends one ping at a time, each after the previous pong", () => {
    const { sync, sent, reply } = setup();
    expect(sent).toEqual([0]);

    reply(10, 1000);
    expect(sent).toEqual([0, 1]);
    reply(10, 1000);
    reply(10, 1000);

    expect(sent).toEqual([0, 1, 2]);
    expect(sync.estimateServerNowMs()).not.toBeNull();
  });

  it("has no estimate before the first round completes", () => {
    const { sync, reply } = setup();
    reply(10, 1000);
    expect(sync.estimateServerNowMs()).toBeNull();
  });

  it("uses the lowest round trip of the round", () => {
    const { sync, reply } = setup();

    reply(100, 10_000); // sent 0, received 100: offset 10_000 - 50 = 9950
    reply(20, 10_200); // sent 100, received 120: offset 10_200 - 110 = 10_090
    reply(60, 10_300); // sent 120, received 180: offset 10_300 - 150 = 10_150

    // Now is 180, so the best sample gives 180 + 10_090.
    expect(sync.estimateServerNowMs()).toBe(10_270);
  });

  it("ignores unknown and duplicate pongs", () => {
    const { sync, sent, reply } = setup();

    sync.handlePong({ id: 99, serverTimeMs: 1 });
    expect(sent).toEqual([0]);

    reply(10, 5000);
    sync.handlePong({ id: 0, serverTimeMs: 999_999 });
    expect(sent).toEqual([0, 1]);

    reply(10, 5010);
    reply(10, 5020);
    // Every accepted sample gives offset 4995; the duplicate would not.
    expect(sync.estimateServerNowMs()).toBe(30 + 4995);
  });

  it("moves on after a timeout and ignores the late pong", () => {
    const { sync, sent, advance, reply } = setup();

    reply(10, 5000); // offset 4995
    advance(TIMEOUT_MS); // ping 1 times out
    expect(sent).toEqual([0, 1, 2]);

    sync.handlePong({ id: 1, serverTimeMs: 999_999 });
    expect(sent).toEqual([0, 1, 2]);

    reply(10, 7015); // sent 2010, received 2020: offset 7015 - 2015 = 5000
    // Best of the two accepted samples (both RTT 10) is the first: 4995.
    expect(sync.estimateServerNowMs()).toBe(2020 + 4995);
  });

  it("survives a round in which every ping times out", () => {
    const { sync, sent, advance } = setup();

    advance(TIMEOUT_MS * 3);

    expect(sent).toEqual([0, 1, 2]);
    expect(sync.estimateServerNowMs()).toBeNull();
  });

  it("keeps the previous estimate when a later round fails", () => {
    const { sync, advance, reply } = setup();
    reply(10, 5000);
    reply(10, 5010);
    reply(10, 5020);
    const before = sync.estimateServerNowMs();

    advance(RESYNC_MS);
    advance(TIMEOUT_MS * 3);

    expect(before).not.toBeNull();
    expect(sync.estimateServerNowMs()).toBe((before ?? 0) + RESYNC_MS + TIMEOUT_MS * 3);
  });

  it("does not throw when sending a ping fails", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sync } = setup({
      sendPing: () => {
        throw new Error("socket closed");
      },
    });

    expect(sync.estimateServerNowMs()).toBeNull();
    expect(error).toHaveBeenCalledTimes(3);
  });

  it("starts the next round after the resync interval", () => {
    const { sent, advance, reply } = setup();
    reply(10, 1000);
    reply(10, 1000);
    reply(10, 1000);

    advance(RESYNC_MS - 1);
    expect(sent).toHaveLength(3);

    advance(1);
    expect(sent).toHaveLength(4);
  });

  it("ignores resyncNow while a round is running and starts one otherwise", () => {
    const { sync, sent, reply } = setup();

    sync.resyncNow();
    expect(sent).toEqual([0]);

    reply(10, 1000);
    reply(10, 1000);
    reply(10, 1000);
    expect(vi.getTimerCount()).toBe(1); // the scheduled resync

    sync.resyncNow();
    expect(sent).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(1); // resync replaced by the new ping timeout
  });

  it("clears timers and ignores pongs after dispose", () => {
    const { sync, sent, advance, reply } = setup();
    reply(10, 1000);

    sync.dispose();

    expect(vi.getTimerCount()).toBe(0);
    sync.handlePong({ id: 1, serverTimeMs: 1000 });
    advance(RESYNC_MS * 2);
    sync.resyncNow();
    expect(sent).toEqual([0, 1]);
    expect(sync.estimateServerNowMs()).toBeNull();
  });
});
