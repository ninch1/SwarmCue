import { randomInt, randomUUID } from "node:crypto";
import {
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
  type ParticipantId,
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
