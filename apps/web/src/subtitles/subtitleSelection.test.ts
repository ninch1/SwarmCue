import { describe, expect, it } from "vitest";
import {
  initialSubtitleSelection,
  subtitleSelectionReducer,
  type SubtitleSelection,
  type SubtitleSelectionEvent,
} from "./subtitleSelection.js";

function run(...events: SubtitleSelectionEvent[]): SubtitleSelection {
  return events.reduce(subtitleSelectionReducer, initialSubtitleSelection);
}

describe("subtitleSelectionReducer", () => {
  it("starts with subtitles off", () => {
    expect(initialSubtitleSelection).toEqual({ active: "off", userTurnedOff: false, last: null });
  });

  it("turns a new room subtitle on for someone without a subtitle", () => {
    expect(run({ type: "sharedArrived" })).toMatchObject({ active: "shared", last: "shared" });
  });

  it("keeps a room subtitle off for someone who turned subtitles off", () => {
    const selection = run(
      { type: "sharedArrived" },
      { type: "select", source: "off" },
      { type: "sharedArrived" },
    );

    expect(selection).toEqual({ active: "off", userTurnedOff: true, last: "shared" });
  });

  it("does not replace a personal subtitle with a new room subtitle", () => {
    const selection = run({ type: "personalLoaded" }, { type: "sharedArrived" });

    expect(selection.active).toBe("personal");
  });

  it("keeps showing the room subtitle when it is replaced", () => {
    expect(run({ type: "sharedArrived" }, { type: "sharedArrived" }).active).toBe("shared");
  });

  it("shows a personal subtitle as soon as it is picked, even over the room's", () => {
    const selection = run({ type: "sharedArrived" }, { type: "personalLoaded" });

    expect(selection).toEqual({ active: "personal", userTurnedOff: false, last: "personal" });
  });

  it("turns subtitles off when the personal subtitle in use is removed", () => {
    const selection = run(
      { type: "sharedArrived" },
      { type: "personalLoaded" },
      { type: "personalRemoved" },
    );

    expect(selection).toEqual({ active: "off", userTurnedOff: false, last: null });
  });

  it("keeps the personal subtitle when the room subtitle is removed", () => {
    const selection = run(
      { type: "sharedArrived" },
      { type: "personalLoaded" },
      { type: "sharedRemoved" },
    );

    expect(selection).toMatchObject({ active: "personal", last: "personal" });
  });

  it("turns subtitles off when the room subtitle in use is removed", () => {
    const selection = run(
      { type: "personalLoaded" },
      { type: "select", source: "shared" },
      { type: "sharedRemoved" },
    );

    expect(selection).toEqual({ active: "off", userTurnedOff: false, last: null });
  });

  it("lets the user switch between sources", () => {
    const selection = run(
      { type: "personalLoaded" },
      { type: "sharedArrived" },
      { type: "select", source: "shared" },
    );
    expect(selection).toEqual({ active: "shared", userTurnedOff: false, last: "shared" });

    expect(subtitleSelectionReducer(selection, { type: "select", source: "personal" })).toEqual({
      active: "personal",
      userTurnedOff: false,
      last: "personal",
    });
  });

  it("remembers the last source while off", () => {
    expect(run({ type: "personalLoaded" }, { type: "select", source: "off" })).toEqual({
      active: "off",
      userTurnedOff: true,
      last: "personal",
    });
  });

  it("shows the sharer their own subtitle, even after turning subtitles off", () => {
    const selection = run(
      { type: "select", source: "off" },
      { type: "sharing" },
      { type: "sharedArrived" },
    );

    expect(selection).toEqual({ active: "shared", userTurnedOff: false, last: "shared" });
  });

  it("starts over when the media changes", () => {
    const selection = run(
      { type: "personalLoaded" },
      { type: "select", source: "off" },
      { type: "reset" },
    );

    expect(selection).toEqual(initialSubtitleSelection);
  });
});
