import { describe, expect, it } from "vitest";
import { isTorrentStoreDirName } from "./storage.js";

describe("isTorrentStoreDirName", () => {
  it("matches WebTorrent store folders", () => {
    expect(isTorrentStoreDirName("movie.mp4 - 0123abcd")).toBe(true);
    expect(isTorrentStoreDirName("My Show S01 - deadbeef")).toBe(true);
  });

  it("ignores other entries", () => {
    expect(isTorrentStoreDirName("chunks")).toBe(false);
    expect(isTorrentStoreDirName("movie.mp4")).toBe(false);
    expect(isTorrentStoreDirName("movie - 0123ABCD")).toBe(false);
    expect(isTorrentStoreDirName("movie - 0123abc")).toBe(false);
  });
});
