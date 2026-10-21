import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { createHttpApp } from "./http/app.js";
import { attachRealtime } from "./realtime/attach.js";
import { generateParticipantId, generateRoomId } from "./rooms/ids.js";
import { createRoomStore } from "./rooms/index.js";

/** V1 rooms are designed and tested for up to five participants. */
const MAX_PARTICIPANTS = 5;
/** Room messages are tiny; anything larger is rejected by `ws` before parsing. */
const MAX_MESSAGE_BYTES = 4 * 1024;

export type CoordinationServer = {
  server: Server;
  wss: WebSocketServer;
};

export function createCoordinationServer(): CoordinationServer {
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
    maxParticipants: MAX_PARTICIPANTS,
  });
  attachRealtime(wss, rooms);

  return { server, wss };
}
