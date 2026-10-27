import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
  type ParticipantId,
  type ResumeToken,
  type RoomId,
} from "@swarmcue/protocol";

/**
 * Room codes double as the room's secret, so they come from a CSPRNG.
 * 32^8 ≈ 1.1 trillion possible codes (~40 bits).
 */
export function generateRoomId(): RoomId {
  let id = "";
  for (let index = 0; index < ROOM_ID_LENGTH; index += 1) {
    id += ROOM_ID_ALPHABET.charAt(randomInt(ROOM_ID_ALPHABET.length));
  }
  return id;
}

export function generateParticipantId(): ParticipantId {
  return randomUUID();
}

/** 32 bytes (256 bits) from a CSPRNG, as 43 base64url characters. */
export function generateResumeToken(): ResumeToken {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is kept in memory, never the token itself. */
export function hashResumeToken(token: ResumeToken): string {
  return createHash("sha256").update(token).digest("base64url");
}
