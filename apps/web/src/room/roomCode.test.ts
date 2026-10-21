import { describe, expect, it } from "vitest";
import { formatRoomCode, normalizeRoomCode } from "./roomCode.js";

describe("normalizeRoomCode", () => {
  it("uppercases and strips hyphens and spaces", () => {
    expect(normalizeRoomCode(" k7qm-3xpd ")).toBe("K7QM3XPD");
    expect(normalizeRoomCode("K7QM 3XPD")).toBe("K7QM3XPD");
  });
});

describe("formatRoomCode", () => {
  it("inserts a hyphen in the middle", () => {
    expect(formatRoomCode("K7QM3XPD")).toBe("K7QM-3XPD");
  });

  it("round-trips through normalizeRoomCode", () => {
    expect(normalizeRoomCode(formatRoomCode("K7QM3XPD"))).toBe("K7QM3XPD");
  });
});
