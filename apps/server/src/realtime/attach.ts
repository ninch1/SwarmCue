import type { WebSocketServer } from "ws";

/**
 * Attaches WebSocket handling. Room join/create logic is added in Milestone 1.
 */
export function attachRealtime(wss: WebSocketServer): void {
  wss.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "connected",
        message: "SwarmCue realtime ready",
      }),
    );
  });
}
