import { describe, expect, it } from "vitest";
import {
  expectedPositionSeconds,
  isEquivalentPlayback,
  planCorrection,
  type PlaybackAnchor,
} from "./index.js";

const playingAt10: PlaybackAnchor = {
  status: "playing",
  positionSeconds: 10,
  updatedAtServerMs: 1_000_000,
};

describe("expectedPositionSeconds", () => {
  it("advances in real time while playing", () => {
    expect(expectedPositionSeconds(playingAt10, 1_002_500)).toBe(12.5);
  });

  it("stays fixed while paused", () => {
    const paused: PlaybackAnchor = { ...playingAt10, status: "paused" };
    expect(expectedPositionSeconds(paused, 1_060_000)).toBe(10);
  });

  it("does not go backwards when the server time estimate is behind the anchor", () => {
    expect(expectedPositionSeconds(playingAt10, 999_900)).toBe(10);
  });
});

describe("isEquivalentPlayback", () => {
  it("treats the same status near the expected position as unchanged", () => {
    expect(
      isEquivalentPlayback(playingAt10, { status: "playing", positionSeconds: 12.4 }, 1_002_500),
    ).toBe(true);
  });

  it("treats a different status as a change", () => {
    expect(
      isEquivalentPlayback(playingAt10, { status: "paused", positionSeconds: 12.5 }, 1_002_500),
    ).toBe(false);
  });

  it("treats a seek beyond the tolerance as a change", () => {
    expect(
      isEquivalentPlayback(playingAt10, { status: "playing", positionSeconds: 30 }, 1_002_500),
    ).toBe(false);
  });
});

describe("planCorrection", () => {
  it("does nothing within the threshold", () => {
    expect(
      planCorrection({
        expectedSeconds: 20,
        actualSeconds: 20.4,
        thresholdSeconds: 0.5,
        durationSeconds: 100,
      }),
    ).toEqual({ kind: "none" });
  });

  it("seeks to the expected position beyond the threshold, ahead or behind", () => {
    expect(
      planCorrection({
        expectedSeconds: 20,
        actualSeconds: 18,
        thresholdSeconds: 0.5,
        durationSeconds: 100,
      }),
    ).toEqual({ kind: "seek", toSeconds: 20 });
    expect(
      planCorrection({
        expectedSeconds: 20,
        actualSeconds: 21,
        thresholdSeconds: 0.5,
        durationSeconds: null,
      }),
    ).toEqual({ kind: "seek", toSeconds: 20 });
  });

  it("never targets a position past the end of the media", () => {
    expect(
      planCorrection({
        expectedSeconds: 130,
        actualSeconds: 90,
        thresholdSeconds: 0.5,
        durationSeconds: 120,
      }),
    ).toEqual({ kind: "seek", toSeconds: 120 });
    expect(
      planCorrection({
        expectedSeconds: 130,
        actualSeconds: 120,
        thresholdSeconds: 0.5,
        durationSeconds: 120,
      }),
    ).toEqual({ kind: "none" });
  });

  it("ignores an unknown (NaN) duration", () => {
    expect(
      planCorrection({
        expectedSeconds: 30,
        actualSeconds: 10,
        thresholdSeconds: 0.5,
        durationSeconds: Number.NaN,
      }),
    ).toEqual({ kind: "seek", toSeconds: 30 });
  });
});
