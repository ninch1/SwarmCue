import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
  ProtocolVersion,
  ServerMessageSchema,
  type ServerMessage,
} from "@swarmcue/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createCoordinationServer, type CoordinationServer } from "../server.js";

const MESSAGE_TIMEOUT_MS = 2000;

const media = {
  magnetUri: "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=movie.mp4",
  name: "movie.mp4",
  sizeBytes: 1024,
};

function mediaSet(sharedMedia: unknown) {
  return { type: "media.set", protocolVersion: ProtocolVersion, media: sharedMedia };
}

type TestClient = {
  socket: WebSocket;
  send: (message: unknown) => void;
  sendRaw: (data: string) => void;
  next: () => Promise<ServerMessage>;
  close: () => Promise<void>;
};

async function connect(url: string): Promise<TestClient> {
  const socket = new WebSocket(url);
  const queue: ServerMessage[] = [];
  const waiters: ((message: ServerMessage) => void)[] = [];

  socket.on("message", (data) => {
    // Also asserts that everything the server sends matches the protocol.
    const message = ServerMessageSchema.parse(JSON.parse(String(data)));
    const waiter = waiters.shift();
    if (waiter) {
      waiter(message);
    } else {
      queue.push(message);
    }
  });

  await once(socket, "open");

  return {
    socket,
    send: (message) => socket.send(JSON.stringify(message)),
    sendRaw: (data) => socket.send(data),
    next: () =>
      new Promise((resolve, reject) => {
        const queued = queue.shift();
        if (queued) {
          resolve(queued);
          return;
        }
        const waiter = (message: ServerMessage) => {
          clearTimeout(timer);
          resolve(message);
        };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error("Timed out waiting for a server message"));
        }, MESSAGE_TIMEOUT_MS);
        waiters.push(waiter);
      }),
    close: async () => {
      if (socket.readyState === WebSocket.CLOSED) {
        return;
      }
      socket.close();
      await once(socket, "close");
    },
  };
}

describe("realtime rooms", () => {
  let coordination: CoordinationServer;
  let url: string;
  const clients: TestClient[] = [];

  async function client(): Promise<TestClient> {
    const created = await connect(url);
    clients.push(created);
    return created;
  }

  /** Ada creates a room (host) and Grace joins it; all join messages are consumed. */
  async function hostAndViewer() {
    const host = await client();
    host.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });
    const created = await host.next();
    if (created.type !== "room.joined") throw new Error("expected room.joined");

    const viewer = await client();
    viewer.send({
      type: "room.join",
      protocolVersion: ProtocolVersion,
      roomId: created.snapshot.roomId,
      displayName: "Grace",
    });
    const joined = await viewer.next();
    if (joined.type !== "room.joined") throw new Error("expected room.joined");
    await host.next();

    return {
      host,
      viewer,
      roomId: created.snapshot.roomId,
      viewerId: joined.selfId,
    };
  }

  beforeEach(async () => {
    coordination = createCoordinationServer();
    coordination.server.listen(0, "127.0.0.1");
    await once(coordination.server, "listening");
    const { port } = coordination.server.address() as AddressInfo;
    url = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((created) => created.close()));
    for (const socket of coordination.wss.clients) {
      socket.terminate();
    }
    coordination.wss.close();
    await new Promise<void>((resolve, reject) => {
      coordination.server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("gives two clients the same participant state", async () => {
    const ada = await client();
    ada.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });
    const created = await ada.next();
    expect(created.type).toBe("room.joined");
    if (created.type !== "room.joined") return;
    expect(created.snapshot.participants).toEqual([
      { id: created.selfId, displayName: "Ada" },
    ]);

    const grace = await client();
    grace.send({
      type: "room.join",
      protocolVersion: ProtocolVersion,
      roomId: created.snapshot.roomId,
      displayName: "Grace",
    });
    const joined = await grace.next();
    const update = await ada.next();

    expect(joined.type).toBe("room.joined");
    expect(update.type).toBe("room.snapshot");
    if (joined.type !== "room.joined" || update.type !== "room.snapshot") return;

    expect(joined.snapshot.participants).toEqual([
      { id: created.selfId, displayName: "Ada" },
      { id: joined.selfId, displayName: "Grace" },
    ]);
    expect(update.snapshot).toEqual(joined.snapshot);
  });

  it("notifies remaining participants when someone disconnects", async () => {
    const ada = await client();
    ada.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });
    const created = await ada.next();
    if (created.type !== "room.joined") throw new Error("expected room.joined");

    const grace = await client();
    grace.send({
      type: "room.join",
      protocolVersion: ProtocolVersion,
      roomId: created.snapshot.roomId,
      displayName: "Grace",
    });
    await grace.next();
    await ada.next();

    await grace.close();

    expect(await ada.next()).toEqual({
      type: "room.snapshot",
      snapshot: {
        roomId: created.snapshot.roomId,
        hostId: created.selfId,
        participants: [{ id: created.selfId, displayName: "Ada" }],
        media: null,
      },
    });
  });

  it("promotes the remaining participant when the host disconnects", async () => {
    const { host, viewer, roomId, viewerId } = await hostAndViewer();

    await host.close();

    expect(await viewer.next()).toEqual({
      type: "room.snapshot",
      snapshot: {
        roomId,
        hostId: viewerId,
        participants: [{ id: viewerId, displayName: "Grace" }],
        media: null,
      },
    });
  });

  it("broadcasts media set by the host to everyone, including the host", async () => {
    const { host, viewer } = await hostAndViewer();

    host.send(mediaSet(media));

    const hostUpdate = await host.next();
    const viewerUpdate = await viewer.next();
    expect(hostUpdate).toMatchObject({ type: "room.snapshot", snapshot: { media } });
    expect(viewerUpdate).toEqual(hostUpdate);
  });

  it("rejects media from a non-host without broadcasting", async () => {
    const { host, viewer } = await hostAndViewer();

    viewer.send(mediaSet(media));
    expect(await viewer.next()).toMatchObject({ type: "error", code: "not_host" });

    // If the rejected attempt had been broadcast, it would arrive before this one.
    const hostMedia = { ...media, name: "host.mp4" };
    host.send(mediaSet(hostMedia));
    expect(await host.next()).toMatchObject({
      type: "room.snapshot",
      snapshot: { media: hostMedia },
    });
    expect(await viewer.next()).toMatchObject({
      type: "room.snapshot",
      snapshot: { media: hostMedia },
    });
  });

  it("rejects media before joining a room", async () => {
    const ada = await client();

    ada.send(mediaSet(media));

    expect(await ada.next()).toMatchObject({ type: "error", code: "not_in_room" });
  });

  it("rejects a malformed magnet", async () => {
    const { host } = await hostAndViewer();

    host.send(mediaSet({ ...media, magnetUri: "magnet:?xt=urn:btih:nope" }));

    expect(await host.next()).toMatchObject({ type: "error", code: "invalid_message" });
  });

  it("includes the current media when a participant joins late", async () => {
    const { host, viewer, roomId } = await hostAndViewer();
    host.send(mediaSet(media));
    await host.next();
    await viewer.next();

    const late = await client();
    late.send({
      type: "room.join",
      protocolVersion: ProtocolVersion,
      roomId,
      displayName: "Linus",
    });

    expect(await late.next()).toMatchObject({
      type: "room.joined",
      snapshot: { media },
    });
  });

  it("rejects malformed messages and keeps the connection usable", async () => {
    const ada = await client();

    ada.sendRaw("{not json");
    expect(await ada.next()).toMatchObject({ type: "error", code: "invalid_message" });

    ada.send({ type: "room.create", protocolVersion: ProtocolVersion });
    expect(await ada.next()).toMatchObject({ type: "error", code: "invalid_message" });

    ada.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });
    expect(await ada.next()).toMatchObject({ type: "room.joined" });
  });

  it("rejects an unsupported protocol version", async () => {
    const ada = await client();

    ada.send({ type: "room.create", protocolVersion: 999, displayName: "Ada" });

    expect(await ada.next()).toMatchObject({ type: "error", code: "unsupported_version" });
  });

  it("rejects joining an unknown room", async () => {
    const grace = await client();

    grace.send({
      type: "room.join",
      protocolVersion: ProtocolVersion,
      roomId: "ZZZZZZZZ",
      displayName: "Grace",
    });

    expect(await grace.next()).toMatchObject({ type: "error", code: "room_not_found" });
  });

  it("rejects creating a second room on the same connection", async () => {
    const ada = await client();
    ada.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });
    await ada.next();

    ada.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });

    expect(await ada.next()).toMatchObject({ type: "error", code: "already_in_room" });
  });
});
