import { describe, expect, it } from "vitest";
import { isMagnetUri } from "./magnet.js";

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
