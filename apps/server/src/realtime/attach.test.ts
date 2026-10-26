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
const SERVER_NOW_MS = 1_700_000_000_000;
const initialPlayback = {
  status: "paused",
  positionSeconds: 0,
  updatedAtServerMs: SERVER_NOW_MS,
  revision: 0,
};

function clockPing(id: number) {
  return { type: "clock.ping", protocolVersion: ProtocolVersion, id };
}

const media = {
  magnetUri: "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=movie.mp4",
  name: "movie.mp4",
  sizeBytes: 1024,
};

function mediaSet(sharedMedia: unknown) {
  return { type: "media.set", protocolVersion: ProtocolVersion, media: sharedMedia };
}

function playbackSet(status: "playing" | "paused", positionSeconds = 0) {
  return { type: "playback.set", protocolVersion: ProtocolVersion, status, positionSeconds };
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

  /** hostAndViewer, plus shared media; the media snapshots are consumed. */
  async function roomWithMedia() {
    const room = await hostAndViewer();
    room.host.send(mediaSet(media));
    await room.host.next();
    await room.viewer.next();
    return room;
  }

  beforeEach(async () => {
    coordination = createCoordinationServer({ now: () => SERVER_NOW_MS });
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
        playback: initialPlayback,
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
        playback: initialPlayback,
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

  it("lets a viewer play and the host pause, broadcasting each change to everyone", async () => {
    const { host, viewer } = await roomWithMedia();

    viewer.send(playbackSet("playing"));
    const playing = { type: "room.snapshot", snapshot: { playback: { status: "playing" } } };
    expect(await viewer.next()).toMatchObject(playing);
    expect(await host.next()).toMatchObject(playing);

    host.send(playbackSet("paused"));
    const paused = { type: "room.snapshot", snapshot: { playback: { status: "paused" } } };
    expect(await host.next()).toMatchObject(paused);
    expect(await viewer.next()).toMatchObject(paused);
  });

  it("does not broadcast a playback status that is already in effect", async () => {
    const { host, viewer } = await roomWithMedia();
    viewer.send(playbackSet("playing"));
    await viewer.next();
    await host.next();

    host.send(playbackSet("playing"));
    // If the repeated command had been broadcast, it would arrive before this one.
    host.send(playbackSet("paused"));
    expect(await host.next()).toMatchObject({
      type: "room.snapshot",
      snapshot: { playback: { status: "paused" } },
    });
    expect(await viewer.next()).toMatchObject({
      type: "room.snapshot",
      snapshot: { playback: { status: "paused" } },
    });
  });

  it("broadcasts a seek with the reported position and the server's timestamp", async () => {
    const { host, viewer } = await roomWithMedia();
    viewer.send(playbackSet("playing", 0));
    await viewer.next();
    await host.next();

    host.send(playbackSet("playing", 95.5));

    const seeked = {
      type: "room.snapshot",
      snapshot: {
        playback: {
          status: "playing",
          positionSeconds: 95.5,
          updatedAtServerMs: SERVER_NOW_MS,
          revision: 3,
        },
      },
    };
    expect(await host.next()).toMatchObject(seeked);
    expect(await viewer.next()).toMatchObject(seeked);
  });

  it("gives a late joiner the current position and its server timestamp", async () => {
    const { host, viewer, roomId } = await roomWithMedia();
    host.send(playbackSet("playing", 42));
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
      snapshot: {
        playback: {
          status: "playing",
          positionSeconds: 42,
          updatedAtServerMs: SERVER_NOW_MS,
        },
      },
    });
  });

  it("rejects playback without a position", async () => {
    const { host } = await roomWithMedia();

    host.send({ type: "playback.set", protocolVersion: ProtocolVersion, status: "playing" });

    expect(await host.next()).toMatchObject({ type: "error", code: "invalid_message" });
  });

  it("rejects playback before any media is shared", async () => {
    const { viewer } = await hostAndViewer();

    viewer.send(playbackSet("playing"));

    expect(await viewer.next()).toMatchObject({ type: "error", code: "no_media" });
  });

  it("rejects playback before joining a room", async () => {
    const ada = await client();

    ada.send(playbackSet("playing"));

    expect(await ada.next()).toMatchObject({ type: "error", code: "not_in_room" });
  });

  it("resets playback to paused for everyone when the host changes media", async () => {
    const { host, viewer } = await roomWithMedia();
    viewer.send(playbackSet("playing"));
    await viewer.next();
    await host.next();

    host.send(mediaSet({ ...media, name: "other.mp4" }));

    const reset = {
      type: "room.snapshot",
      snapshot: { media: { name: "other.mp4" }, playback: { status: "paused" } },
    };
    expect(await host.next()).toMatchObject(reset);
    expect(await viewer.next()).toMatchObject(reset);
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

  it("answers a clock ping before joining a room", async () => {
    const ada = await client();

    ada.send(clockPing(42));

    expect(await ada.next()).toEqual({
      type: "clock.pong",
      id: 42,
      serverTimeMs: SERVER_NOW_MS,
    });
  });

  it("answers clock pings inside a room without broadcasting", async () => {
    const { host, viewer } = await hostAndViewer();

    host.send(clockPing(1));
    expect(await host.next()).toEqual({
      type: "clock.pong",
      id: 1,
      serverTimeMs: SERVER_NOW_MS,
    });

    // If the ping had reached the viewer, it would arrive before this snapshot.
    host.send(mediaSet(media));
    expect(await viewer.next()).toMatchObject({
      type: "room.snapshot",
      snapshot: { media },
    });
  });

  it("rejects a malformed clock ping and keeps the connection usable", async () => {
    const ada = await client();

    ada.send({ type: "clock.ping", protocolVersion: ProtocolVersion, id: -1 });
    expect(await ada.next()).toMatchObject({ type: "error", code: "invalid_message" });

    ada.send({ ...clockPing(2), clientTimeMs: 123 });
    expect(await ada.next()).toMatchObject({ type: "error", code: "invalid_message" });

    ada.send(clockPing(3));
    expect(await ada.next()).toMatchObject({ type: "clock.pong", id: 3 });
  });

  it("rejects creating a second room on the same connection", async () => {
    const ada = await client();
    ada.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });
    await ada.next();

    ada.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });

    expect(await ada.next()).toMatchObject({ type: "error", code: "already_in_room" });
  });
});
