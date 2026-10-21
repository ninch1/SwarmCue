import { describe, expect, it } from "vitest";
import {
  ProtocolVersion,
  ServerMessageSchema,
  parseClientMessage,
} from "./index.js";

const validRoomId = "K7QM3XPD";

describe("parseClientMessage", () => {
  it("accepts room.create and trims the display name", () => {
    const result = parseClientMessage({
      type: "room.create",
      protocolVersion: ProtocolVersion,
      displayName: "  Ada  ",
    });

    expect(result).toEqual({
      ok: true,
      message: {
        type: "room.create",
        protocolVersion: ProtocolVersion,
        displayName: "Ada",
      },
    });
  });

  it("accepts room.join", () => {
    const result = parseClientMessage({
      type: "room.join",
      protocolVersion: ProtocolVersion,
      roomId: validRoomId,
      displayName: "Grace",
    });

    expect(result.ok).toBe(true);
  });

  it.each([
    ["unknown type", { type: "room.destroy", protocolVersion: ProtocolVersion }],
    ["missing display name", { type: "room.create", protocolVersion: ProtocolVersion }],
    [
      "blank display name",
      { type: "room.create", protocolVersion: ProtocolVersion, displayName: "   " },
    ],
    [
      "too-long display name",
      {
        type: "room.create",
        protocolVersion: ProtocolVersion,
        displayName: "x".repeat(33),
      },
    ],
    [
      "control characters in display name",
      { type: "room.create", protocolVersion: ProtocolVersion, displayName: "a\nb" },
    ],
    [
      "lowercase room id",
      {
        type: "room.join",
        protocolVersion: ProtocolVersion,
        roomId: "k7qm3xpd",
        displayName: "Ada",
      },
    ],
    [
      "room id with ambiguous characters",
      {
        type: "room.join",
        protocolVersion: ProtocolVersion,
        roomId: "K7QM3XP0",
        displayName: "Ada",
      },
    ],
    [
      "extra keys",
      {
        type: "room.create",
        protocolVersion: ProtocolVersion,
        displayName: "Ada",
        isHost: true,
      },
    ],
    ["missing protocol version", { type: "room.create", displayName: "Ada" }],
    ["non-object", "room.create"],
    ["null", null],
  ])("rejects %s as invalid_message", (_label, raw) => {
    const result = parseClientMessage(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_message");
    }
  });

  it("reports a different protocol version as unsupported_version", () => {
    const result = parseClientMessage({
      type: "room.create",
      protocolVersion: ProtocolVersion + 1,
      displayName: "Ada",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported_version");
    }
  });
});

describe("ServerMessageSchema", () => {
  it("accepts a room.joined message", () => {
    const result = ServerMessageSchema.safeParse({
      type: "room.joined",
      selfId: "p1",
      snapshot: {
        roomId: validRoomId,
        participants: [{ id: "p1", displayName: "Ada" }],
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects an unknown error code", () => {
    const result = ServerMessageSchema.safeParse({
      type: "error",
      code: "teapot",
      message: "nope",
    });

    expect(result.success).toBe(false);
  });
});
