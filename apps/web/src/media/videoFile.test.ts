import { describe, expect, it } from "vitest";
import { isPlayableVideoName, pickVideoFile } from "./videoFile.js";

describe("isPlayableVideoName", () => {
  it("matches common browser video extensions case-insensitively", () => {
    expect(isPlayableVideoName("movie.mp4")).toBe(true);
    expect(isPlayableVideoName("Movie.WEBM")).toBe(true);
    expect(isPlayableVideoName("subs.srt")).toBe(false);
    expect(isPlayableVideoName("mp4")).toBe(false);
  });
});

describe("pickVideoFile", () => {
  it("returns the largest playable video", () => {
    const files = [
      { name: "sample.mp4", length: 10 },
      { name: "poster.jpg", length: 5000 },
      { name: "feature.mkv", length: 900 },
      { name: "extra.webm", length: 300 },
    ];

    expect(pickVideoFile(files)?.name).toBe("feature.mkv");
  });

  it("returns null when no file is playable", () => {
    expect(pickVideoFile([{ name: "readme.txt", length: 1 }])).toBeNull();
    expect(pickVideoFile([])).toBeNull();
  });
});
