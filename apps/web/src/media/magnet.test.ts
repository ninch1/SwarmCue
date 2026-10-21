import { describe, expect, it } from "vitest";
import { isMagnetUri, magnetMetadata } from "./magnet.js";

const hash = "0123456789abcdef0123456789abcdef01234567";

describe("magnetMetadata", () => {
  it("reads the name and size", () => {
    expect(
      magnetMetadata(`magnet:?xt=urn:btih:${hash}&dn=My%20Movie.mp4&xl=1048576`),
    ).toEqual({ name: "My Movie.mp4", sizeBytes: 1048576 });
  });

  it("returns nulls when name and size are missing", () => {
    expect(magnetMetadata(`magnet:?xt=urn:btih:${hash}`)).toEqual({
      name: null,
      sizeBytes: null,
    });
  });

  it("drops unusable values", () => {
    expect(
      magnetMetadata(`magnet:?xt=urn:btih:${hash}&dn=%20%0A%20&xl=-5`),
    ).toEqual({ name: null, sizeBytes: null });
    expect(magnetMetadata(`magnet:?xt=urn:btih:${hash}&xl=1.5`).sizeBytes).toBeNull();
    expect(
      magnetMetadata(`magnet:?xt=urn:btih:${hash}&xl=99999999999999999999`).sizeBytes,
    ).toBeNull();
  });

  it("removes control characters and truncates long names", () => {
    expect(magnetMetadata(`magnet:?xt=urn:btih:${hash}&dn=a%0Ab`).name).toBe("ab");
    expect(
      magnetMetadata(`magnet:?xt=urn:btih:${hash}&dn=${"x".repeat(300)}`).name,
    ).toHaveLength(255);
  });
});

describe("isMagnetUri", () => {
  it("accepts a typical btih magnet", () => {
    expect(
      isMagnetUri(
        "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=example",
      ),
    ).toBe(true);
  });

  it("rejects empty and non-magnet values", () => {
    expect(isMagnetUri("")).toBe(false);
    expect(isMagnetUri("https://example.com")).toBe(false);
    expect(isMagnetUri("magnet:?dn=only-name")).toBe(false);
  });
});
