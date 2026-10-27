import { describe, expect, it } from "vitest";
import {
  CLOCK_PING_ID_MAX,
  POSITION_SECONDS_MAX,
  ProtocolVersion,
  ServerMessageSchema,
  parseClientMessage,
} from "./index.js";

const validRoomId = "K7QM3XPD";
const hexHash = "c9e15763f722f23e98a29decdfae341b98d53056";
const validMagnet = `magnet:?xt=urn:btih:${hexHash}&dn=movie.mp4`;
/** 43 base64url characters, the encoding of 32 random bytes. */
const validToken = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";

function mediaSet(media: unknown) {
  return { type: "media.set", protocolVersion: ProtocolVersion, media };
}

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

describe("media.set", () => {
  it.each([
    ["file metadata", { magnetUri: validMagnet, name: "movie.mp4", sizeBytes: 1024 }],
    ["unknown metadata", { magnetUri: validMagnet, name: null, sizeBytes: null }],
    [
      "base32 info hash",
      {
        magnetUri: "magnet:?dn=x&xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
        name: null,
        sizeBytes: null,
      },
    ],
  ])("accepts %s", (_label, media) => {
    expect(parseClientMessage(mediaSet(media)).ok).toBe(true);
  });

  it.each([
    ["non-magnet uri", { magnetUri: "https://example.com", name: null, sizeBytes: null }],
    [
      "short info hash",
      { magnetUri: "magnet:?xt=urn:btih:abc", name: null, sizeBytes: null },
    ],
    [
      "too-long magnet",
      {
        magnetUri: `${validMagnet}&tr=${"x".repeat(2048)}`,
        name: null,
        sizeBytes: null,
      },
    ],
    ["negative size", { magnetUri: validMagnet, name: null, sizeBytes: -1 }],
    ["fractional size", { magnetUri: validMagnet, name: null, sizeBytes: 1.5 }],
    ["blank name", { magnetUri: validMagnet, name: "  ", sizeBytes: null }],
    ["control characters in name", { magnetUri: validMagnet, name: "a\nb", sizeBytes: null }],
    ["missing fields", { magnetUri: validMagnet }],
    [
      "extra keys",
      { magnetUri: validMagnet, name: null, sizeBytes: null, hostId: "p1" },
    ],
  ])("rejects %s", (_label, media) => {
    const result = parseClientMessage(mediaSet(media));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_message");
    }
  });
});

describe("playback.set", () => {
  it.each([
    ["playing", 0],
    ["paused", 12.75],
    ["playing", POSITION_SECONDS_MAX],
  ])("accepts %s at %s seconds", (status, positionSeconds) => {
    expect(
      parseClientMessage({
        type: "playback.set",
        protocolVersion: ProtocolVersion,
        status,
        positionSeconds,
      }).ok,
    ).toBe(true);
  });

  it.each([
    ["unknown status", { status: "stopped", positionSeconds: 0 }],
    ["missing status", { positionSeconds: 0 }],
    ["missing position", { status: "playing" }],
    ["negative position", { status: "playing", positionSeconds: -1 }],
    ["infinite position", { status: "playing", positionSeconds: Infinity }],
    ["position above the max", { status: "playing", positionSeconds: POSITION_SECONDS_MAX + 1 }],
    ["string position", { status: "playing", positionSeconds: "10" }],
    ["client timestamp", { status: "playing", positionSeconds: 1, updatedAtServerMs: 1 }],
    ["extra keys", { status: "playing", positionSeconds: 1, revision: 3 }],
  ])("rejects %s", (_label, fields) => {
    const result = parseClientMessage({
      type: "playback.set",
      protocolVersion: ProtocolVersion,
      ...fields,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_message");
    }
  });
});

describe("room.resume", () => {
  function resume(fields: Record<string, unknown>) {
    return {
      type: "room.resume",
      protocolVersion: ProtocolVersion,
      roomId: validRoomId,
      resumeToken: validToken,
      ...fields,
    };
  }

  it("accepts a well-formed resume", () => {
    expect(parseClientMessage(resume({}))).toEqual({ ok: true, message: resume({}) });
  });

  it.each([
    ["short token", { resumeToken: validToken.slice(1) }],
    ["long token", { resumeToken: `${validToken}A` }],
    ["token with invalid characters", { resumeToken: `${validToken.slice(1)}=` }],
    ["missing token", { resumeToken: undefined }],
    ["numeric token", { resumeToken: 42 }],
    ["missing room id", { roomId: undefined }],
    ["invalid room id", { roomId: "k7qm3xpd" }],
    ["participant id instead of token", { participantId: "p1" }],
  ])("rejects %s", (_label, fields) => {
    const result = parseClientMessage(resume(fields));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_message");
    }
  });

  it("reports an older protocol version as unsupported_version", () => {
    const result = parseClientMessage(resume({ protocolVersion: 2 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported_version");
    }
  });
});

describe("room.leave", () => {
  it("accepts a leave command", () => {
    expect(
      parseClientMessage({ type: "room.leave", protocolVersion: ProtocolVersion }).ok,
    ).toBe(true);
  });

  it("rejects extra keys", () => {
    const result = parseClientMessage({
      type: "room.leave",
      protocolVersion: ProtocolVersion,
      participantId: "p1",
    });
    expect(result.ok).toBe(false);
  });
});

describe("clock.ping", () => {
  function clockPing(fields: Record<string, unknown>) {
    return { type: "clock.ping", protocolVersion: ProtocolVersion, ...fields };
  }

  it.each([0, 7, CLOCK_PING_ID_MAX])("accepts id %s", (id) => {
    expect(parseClientMessage(clockPing({ id }))).toEqual({
      ok: true,
      message: { type: "clock.ping", protocolVersion: ProtocolVersion, id },
    });
  });

  it.each([
    ["missing id", {}],
    ["non-integer id", { id: 1.5 }],
    ["string id", { id: "1" }],
    ["negative id", { id: -1 }],
    ["out-of-range id", { id: CLOCK_PING_ID_MAX + 1 }],
    ["client timestamp", { id: 1, clientTimeMs: 1_700_000_000_000 }],
  ])("rejects %s", (_label, fields) => {
    const result = parseClientMessage(clockPing(fields));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_message");
    }
  });

  it("rejects a missing protocol version", () => {
    const result = parseClientMessage({ type: "clock.ping", id: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_message");
    }
  });

  it("reports a different protocol version as unsupported_version", () => {
    const result = parseClientMessage(clockPing({ id: 1, protocolVersion: 999 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported_version");
    }
  });
});

describe("clock.pong", () => {
  it("accepts a valid pong", () => {
    expect(
      ServerMessageSchema.safeParse({
        type: "clock.pong",
        id: 3,
        serverTimeMs: 1_700_000_000_000,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["negative server time", { id: 3, serverTimeMs: -1 }],
    ["fractional server time", { id: 3, serverTimeMs: 1.5 }],
    ["missing server time", { id: 3 }],
    ["missing id", { serverTimeMs: 1 }],
    ["extra keys", { id: 3, serverTimeMs: 1, clientTimeMs: 1 }],
  ])("rejects %s", (_label, fields) => {
    expect(
      ServerMessageSchema.safeParse({ type: "clock.pong", ...fields }).success,
    ).toBe(false);
  });
});

describe("ServerMessageSchema", () => {
  const pausedPlayback = {
    status: "paused",
    positionSeconds: 0,
    updatedAtServerMs: 1_700_000_000_000,
    revision: 0,
  };

  function snapshotWithPlayback(playback: unknown) {
    return {
      type: "room.snapshot",
      snapshot: {
        roomId: validRoomId,
        hostId: "p1",
        participants: [{ id: "p1", displayName: "Ada", connected: true }],
        media: null,
        playback,
      },
    };
  }

  it("accepts a room.joined message", () => {
    const result = ServerMessageSchema.safeParse({
      type: "room.joined",
      selfId: "p1",
      resumeToken: validToken,
      snapshot: {
        roomId: validRoomId,
        hostId: "p1",
        participants: [{ id: "p1", displayName: "Ada", connected: true }],
        media: { magnetUri: validMagnet, name: "movie.mp4", sizeBytes: 1024 },
        playback: { ...pausedPlayback, status: "playing", positionSeconds: 42.5, revision: 3 },
      },
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ["missing position", { status: "paused", updatedAtServerMs: 1, revision: 0 }],
    ["missing server timestamp", { status: "paused", positionSeconds: 0, revision: 0 }],
    ["negative position", { ...pausedPlayback, positionSeconds: -1 }],
    ["fractional server timestamp", { ...pausedPlayback, updatedAtServerMs: 1.5 }],
    ["extra keys", { ...pausedPlayback, playbackRate: 1 }],
  ])("rejects playback state with %s", (_label, playback) => {
    expect(ServerMessageSchema.safeParse(snapshotWithPlayback(playback)).success).toBe(
      false,
    );
  });

  it("rejects a snapshot without playback state", () => {
    const result = ServerMessageSchema.safeParse({
      type: "room.snapshot",
      snapshot: {
        roomId: validRoomId,
        hostId: "p1",
        participants: [{ id: "p1", displayName: "Ada", connected: true }],
        media: null,
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a snapshot with a negative playback revision", () => {
    const result = ServerMessageSchema.safeParse({
      type: "room.snapshot",
      snapshot: {
        roomId: validRoomId,
        hostId: "p1",
        participants: [{ id: "p1", displayName: "Ada", connected: true }],
        media: null,
        playback: { ...pausedPlayback, revision: -1 },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a snapshot whose host is not a participant", () => {
    const result = ServerMessageSchema.safeParse({
      type: "room.snapshot",
      snapshot: {
        roomId: validRoomId,
        hostId: "p2",
        participants: [{ id: "p1", displayName: "Ada", connected: true }],
        media: null,
        playback: pausedPlayback,
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects room.joined without a resume token", () => {
    const { snapshot } = snapshotWithPlayback(pausedPlayback);
    expect(
      ServerMessageSchema.safeParse({ type: "room.joined", selfId: "p1", snapshot }).success,
    ).toBe(false);
  });

  it("accepts room.resumed, which carries no token", () => {
    const { snapshot } = snapshotWithPlayback(pausedPlayback);
    expect(
      ServerMessageSchema.safeParse({ type: "room.resumed", selfId: "p1", snapshot }).success,
    ).toBe(true);
    expect(
      ServerMessageSchema.safeParse({
        type: "room.resumed",
        selfId: "p1",
        resumeToken: validToken,
        snapshot,
      }).success,
    ).toBe(false);
  });

  it("requires a connection status on every participant", () => {
    const message = snapshotWithPlayback(pausedPlayback);
    expect(
      ServerMessageSchema.safeParse({
        ...message,
        snapshot: {
          ...message.snapshot,
          participants: [{ id: "p1", displayName: "Ada" }],
        },
      }).success,
    ).toBe(false);
  });

  it.each(["resume_rejected", "session_replaced"])("accepts the %s error code", (code) => {
    expect(
      ServerMessageSchema.safeParse({ type: "error", code, message: "x" }).success,
    ).toBe(true);
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
