import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { ProtocolVersion } from "@swarmcue/protocol";
import { createHttpApp } from "./http/app.js";
import { attachRealtime } from "./realtime/attach.js";

const port = Number(process.env.PORT) || 3001;

// Express handles HTTP. A shared Node HTTP server is still required so `ws`
// can attach to the same port (do not call app.listen()).
const app = createHttpApp();
const server = createServer(app);
const wss = new WebSocketServer({ server });

attachRealtime(wss);

server.listen(port, () => {
  console.log(
    `SwarmCue coordination server listening on http://localhost:${port} (protocol v${ProtocolVersion})`,
  );
});
