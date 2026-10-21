import { z } from "zod";

/** Shared client-server message contract. */
export const ProtocolVersion = 1 as const;

export type ProtocolVersion = typeof ProtocolVersion;

/** Digits and uppercase letters without look-alikes (0/O, 1/I). 32 characters. */
export const ROOM_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_ID_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 32;

export const RoomIdSchema = z
  .string()
  .regex(
    new RegExp(`^[${ROOM_ID_ALPHABET}]{${ROOM_ID_LENGTH}}$`),
    `Room codes are ${ROOM_ID_LENGTH} letters and digits.`,
  );

export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a display name.")
  .max(
    DISPLAY_NAME_MAX_LENGTH,
    `Display names can be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`,
  )
  .regex(/^\P{Cc}+$/u, "Display names cannot contain control characters.");

export const ParticipantIdSchema = z.string().min(1).max(64);

export const ParticipantSchema = z.strictObject({
  id: ParticipantIdSchema,
  displayName: DisplayNameSchema,
});

/** Complete description of a room at one moment. Participants are in join order. */
export const RoomSnapshotSchema = z.strictObject({
  roomId: RoomIdSchema,
  participants: z.array(ParticipantSchema),
});

// Client → server

export const RoomCreateMessageSchema = z.strictObject({
  type: z.literal("room.create"),
  protocolVersion: z.literal(ProtocolVersion),
  displayName: DisplayNameSchema,
});

export const RoomJoinMessageSchema = z.strictObject({
  type: z.literal("room.join"),
  protocolVersion: z.literal(ProtocolVersion),
  roomId: RoomIdSchema,
  displayName: DisplayNameSchema,
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  RoomCreateMessageSchema,
  RoomJoinMessageSchema,
]);

// Server → client

export const ErrorCodeSchema = z.enum([
  "invalid_message",
  "unsupported_version",
  "room_not_found",
  "room_full",
  "already_in_room",
  "internal_error",
]);

/** Sent only to the participant who created or joined the room. */
export const RoomJoinedMessageSchema = z.strictObject({
  type: z.literal("room.joined"),
  selfId: ParticipantIdSchema,
  snapshot: RoomSnapshotSchema,
});

/** Sent to the other participants whenever room membership changes. */
export const RoomSnapshotMessageSchema = z.strictObject({
  type: z.literal("room.snapshot"),
  snapshot: RoomSnapshotSchema,
});

export const ErrorMessageSchema = z.strictObject({
  type: z.literal("error"),
  code: ErrorCodeSchema,
  message: z.string(),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  RoomJoinedMessageSchema,
  RoomSnapshotMessageSchema,
  ErrorMessageSchema,
]);

export type RoomId = z.infer<typeof RoomIdSchema>;
export type ParticipantId = z.infer<typeof ParticipantIdSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export type ClientMessageParseResult =
  | { ok: true; message: ClientMessage }
  | {
      ok: false;
      code: Extract<ErrorCode, "invalid_message" | "unsupported_version">;
      message: string;
    };

/**
 * Validate an already JSON-decoded client message. A message carrying a
 * different numeric protocol version is reported separately so clients can
 * tell "outdated app" apart from "malformed message".
 */
export function parseClientMessage(raw: unknown): ClientMessageParseResult {
  const result = ClientMessageSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, message: result.data };
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "protocolVersion" in raw &&
    typeof raw.protocolVersion === "number" &&
    raw.protocolVersion !== ProtocolVersion
  ) {
    return {
      ok: false,
      code: "unsupported_version",
      message: `Unsupported protocol version ${raw.protocolVersion}; the server speaks version ${ProtocolVersion}.`,
    };
  }

  return {
    ok: false,
    code: "invalid_message",
    message: result.error.issues[0]?.message ?? "Invalid message.",
  };
}
