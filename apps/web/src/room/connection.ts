import {
  ServerMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "@swarmcue/protocol";

export type RoomConnectionHandlers = {
  onOpen: () => void;
  onMessage: (message: ServerMessage) => void;
  onClose: () => void;
};

export type RoomConnection = {
  send: (message: ClientMessage) => void;
  close: () => void;
};

/** Same origin as the page; in dev the Vite proxy forwards `/ws` to the server. */
function roomServerUrl(): string {
  const url = new URL("/ws", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function openRoomConnection(
  handlers: RoomConnectionHandlers,
): RoomConnection {
  const socket = new WebSocket(roomServerUrl());

  socket.addEventListener("open", handlers.onOpen);
  socket.addEventListener("close", handlers.onClose);
  socket.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (typeof event.data !== "string") {
      console.error("Ignoring non-text message from room server.");
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(event.data);
    } catch {
      console.error("Ignoring non-JSON message from room server.");
      return;
    }

    const parsed = ServerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("Ignoring invalid message from room server:", parsed.error);
      return;
    }
    handlers.onMessage(parsed.data);
  });

  return {
    send: (message) => socket.send(JSON.stringify(message)),
    close: () => socket.close(),
  };
}
