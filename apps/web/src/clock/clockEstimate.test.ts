import { describe, expect, it } from "vitest";
import {
  computeClockSample,
  estimateServerTimeMs,
  selectBestSample,
} from "./clockEstimate.js";

describe("computeClockSample", () => {
  it("computes round trip and offset from fixed values", () => {
    const sample = computeClockSample({
      sentAtMonotonicMs: 1000,
      receivedAtMonotonicMs: 1100,
      serverTimeMs: 50_000,
      maxRoundTripMs: 2000,
    });

    // One-way delay 50 ms, so the server replied at local 1050.
    expect(sample).toEqual({ roundTripMs: 100, monotonicToServerOffsetMs: 48_950 });
    expect(sample && estimateServerTimeMs(sample, 2000)).toBe(50_950);
  });

  it("accepts a zero round trip", () => {
    expect(
      computeClockSample({
        sentAtMonotonicMs: 500,
        receivedAtMonotonicMs: 500,
        serverTimeMs: 10_000,
        maxRoundTripMs: 2000,
      }),
    ).toEqual({ roundTripMs: 0, monotonicToServerOffsetMs: 9500 });
  });

  it.each([
    ["negative round trip", { sentAtMonotonicMs: 1100, receivedAtMonotonicMs: 1000 }],
    ["round trip above the max", { sentAtMonotonicMs: 0, receivedAtMonotonicMs: 2001 }],
    ["NaN receive time", { sentAtMonotonicMs: 0, receivedAtMonotonicMs: Number.NaN }],
    ["infinite send time", { sentAtMonotonicMs: -Infinity, receivedAtMonotonicMs: 0 }],
    [
      "NaN server time",
      { sentAtMonotonicMs: 0, receivedAtMonotonicMs: 10, serverTimeMs: Number.NaN },
    ],
  ])("rejects %s", (_label, overrides) => {
    expect(
      computeClockSample({
        serverTimeMs: 50_000,
        maxRoundTripMs: 2000,
        ...overrides,
      }),
    ).toBeNull();
  });
});

describe("selectBestSample", () => {
  it("returns the sample with the lowest round trip", () => {
    const best = { roundTripMs: 20, monotonicToServerOffsetMs: 3 };
    expect(
      selectBestSample([
        { roundTripMs: 80, monotonicToServerOffsetMs: 1 },
        best,
        { roundTripMs: 45, monotonicToServerOffsetMs: 2 },
      ]),
    ).toBe(best);
  });

  it("returns null for no samples", () => {
    expect(selectBestSample([])).toBeNull();
  });
});
