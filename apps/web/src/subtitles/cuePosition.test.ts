import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDefaultCueLine, DEFAULT_CUE_LINE_PERCENT } from "./cuePosition.js";

/** Stands in for the browser's VTTCue; Node has none. */
class FakeVTTCue {
  line: number | "auto" = "auto";
  snapToLines = true;
  align = "center";
  constructor(
    public startTime: number,
    public endTime: number,
    public text: string,
  ) {}
}

const asCueList = (cues: unknown[]) => cues as unknown as TextTrackCueList;

describe("applyDefaultCueLine", () => {
  beforeEach(() => {
    vi.stubGlobal("VTTCue", FakeVTTCue);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("raises auto-positioned cues to the default percentage", () => {
    const cue = new FakeVTTCue(1, 2, "Hello");

    applyDefaultCueLine(asCueList([cue]));

    expect(cue).toMatchObject({ line: DEFAULT_CUE_LINE_PERCENT, snapToLines: false });
  });

  it("changes nothing but the line position", () => {
    const cue = new FakeVTTCue(1.5, 2.25, "Two\nlines");

    applyDefaultCueLine(asCueList([cue]));

    expect(cue).toMatchObject({ startTime: 1.5, endTime: 2.25, text: "Two\nlines", align: "center" });
  });

  it("leaves cues with an explicit line unchanged", () => {
    const percent = new FakeVTTCue(1, 2, "Top");
    percent.line = 10;
    percent.snapToLines = false;
    const lineNumber = new FakeVTTCue(1, 2, "Line -2");
    lineNumber.line = -2;

    applyDefaultCueLine(asCueList([percent, lineNumber]));

    expect(percent).toMatchObject({ line: 10, snapToLines: false });
    expect(lineNumber).toMatchObject({ line: -2, snapToLines: true });
  });

  it("ignores cue objects that are not VTTCues", () => {
    const other = { line: "auto", snapToLines: true, text: "?" };

    expect(() => applyDefaultCueLine(asCueList([other]))).not.toThrow();
    expect(other).toEqual({ line: "auto", snapToLines: true, text: "?" });
  });

  it("is harmless to apply more than once", () => {
    const cue = new FakeVTTCue(1, 2, "Hello");
    const cues = asCueList([cue]);

    applyDefaultCueLine(cues);
    applyDefaultCueLine(cues);

    expect(cue).toMatchObject({ line: DEFAULT_CUE_LINE_PERCENT, snapToLines: false });
  });

  it("does nothing without cues or without VTTCue support", () => {
    expect(() => applyDefaultCueLine(null)).not.toThrow();
    expect(() => applyDefaultCueLine(undefined)).not.toThrow();

    vi.unstubAllGlobals();
    const cue = { line: "auto", snapToLines: true };
    expect(() => applyDefaultCueLine(asCueList([cue]))).not.toThrow();
    expect(cue.line).toBe("auto");
  });
});
