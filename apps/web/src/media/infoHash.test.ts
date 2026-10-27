import { describe, expect, it } from "vitest";
import { infoHashOf, isSameTorrent } from "./infoHash.js";

const hash = "c9e15763f722f23e98a29decdfae341b98d53056";

describe("infoHashOf", () => {
  it("reads a hex info hash and lowercases it", () => {
    expect(infoHashOf(`magnet:?xt=urn:btih:${hash.toUpperCase()}&dn=movie.mp4`)).toBe(hash);
  });

  it("reads a base32 info hash that is not the first parameter", () => {
    expect(
      infoHashOf("magnet:?dn=x&xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"),
    ).toBe("abcdefghijklmnopqrstuvwxyz234567");
  });

  it("returns null without a valid info hash", () => {
    expect(infoHashOf("magnet:?dn=only-name")).toBeNull();
    expect(infoHashOf("magnet:?xt=urn:btih:abc")).toBeNull();
  });
});

describe("isSameTorrent", () => {
  it("matches magnets with the same hash even if other parameters differ", () => {
    expect(
      isSameTorrent(
        `magnet:?xt=urn:btih:${hash}&dn=a.mp4&tr=wss%3A%2F%2Fone`,
        `magnet:?xt=urn:btih:${hash.toUpperCase()}&dn=b.mp4`,
      ),
    ).toBe(true);
  });

  it("does not match different hashes or missing magnets", () => {
    expect(isSameTorrent(`magnet:?xt=urn:btih:${hash}`, `magnet:?xt=urn:btih:${"0".repeat(40)}`)).toBe(false);
    expect(isSameTorrent(null, `magnet:?xt=urn:btih:${hash}`)).toBe(false);
  });
});
