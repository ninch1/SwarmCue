import { createServer, type Server } from "node:http";
import { SHARED_SUBTITLE_MAX_BYTES } from "@swarmcue/protocol";
import { WebSocketServer } from "ws";
import { createHttpApp } from "./http/app.js";
import { attachRealtime, realScheduler, type Scheduler } from "./realtime/attach.js";
import {
  generateParticipantId,
  generateResumeToken,
  generateRoomId,
  generateSubtitleId,
  hashResumeToken,
} from "./rooms/ids.js";
import { createRoomStore } from "./rooms/index.js";

/** V1 rooms are designed and tested for up to five participants. */
const MAX_PARTICIPANTS = 5;
/**
 * Largest WebSocket message `ws` accepts; anything larger closes the
 * connection (1009) before it is parsed. Sized for `subtitle.set`: at most
 * SHARED_SUBTITLE_MAX_BYTES (512 KiB) of content, which JSON.stringify can
 * at most double (only `"`, `\`, newline and tab are escaped; the schema
 * rejects other control characters), plus a few KiB for the name and envelope.
 * The schema then enforces the exact UTF-8 limit.
 */
export const MAX_MESSAGE_BYTES = 2 * SHARED_SUBTITLE_MAX_BYTES + 8 * 1024;
/**
 * How long a disconnected participant keeps their place (and a host their
 * role). Covers page refreshes and short network drops; deliberate leaves
 * skip it via room.leave.
 */
export const DEFAULT_GRACE_MS = 30_000;
/** A silent connection is detected within two intervals (≤ 30 s). */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

export type CoordinationServer = {
  server: Server;
  wss: WebSocketServer;
};

export type CoordinationServerOptions = {
  /** Server clock in epoch ms; injectable so tests can assert exact times. */
  now?: () => number;
  graceMs?: number;
  /** Timer functions for wake-ups and heartbeats; injectable for deterministic tests. */
  scheduler?: Scheduler;
  /** 0 disables the heartbeat. */
  heartbeatIntervalMs?: number;
};

export function createCoordinationServer({
  now = Date.now,
  graceMs = DEFAULT_GRACE_MS,
  scheduler = realScheduler,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
}: CoordinationServerOptions = {}): CoordinationServer {
  // Express handles HTTP. A shared Node HTTP server is still required so `ws`
  // can attach to the same port (do not call app.listen()).
  const server = createServer(createHttpApp());
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: MAX_MESSAGE_BYTES,
  });

  const rooms = createRoomStore({
    generateRoomId,
    generateParticipantId,
    generateResumeToken,
    generateSubtitleId,
    hashResumeToken,
    maxParticipants: MAX_PARTICIPANTS,
    graceMs,
    now,
  });
  attachRealtime(wss, rooms, { now, scheduler, heartbeatIntervalMs });

  return { server, wss };
}
