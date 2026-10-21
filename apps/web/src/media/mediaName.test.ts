import { MEDIA_NAME_MAX_LENGTH } from "@swarmcue/protocol";
import { describe, expect, it } from "vitest";
import { toMediaName } from "./mediaName.js";

describe("toMediaName", () => {
  it("keeps a normal file name", () => {
    expect(toMediaName("My Movie.mp4")).toBe("My Movie.mp4");
  });

  it("trims whitespace and removes control characters", () => {
    expect(toMediaName("  a\nb\t.mp4  ")).toBe("ab.mp4");
  });

  it("truncates long names to the schema limit", () => {
    expect(toMediaName("x".repeat(300))).toHaveLength(MEDIA_NAME_MAX_LENGTH);
  });

  it("returns null when nothing usable is left", () => {
    expect(toMediaName("")).toBeNull();
    expect(toMediaName(" \n ")).toBeNull();
  });
});
