import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
  ProtocolVersion,
  ServerMessageSchema,
  type ServerMessage,
} from "@swarmcue/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  createCoordinationServer,
  MAX_MESSAGE_BYTES,
  type CoordinationServer,
} from "../server.js";
import { SESSION_REPLACED_CLOSE_CODE, type Scheduler } from "./attach.js";

const MESSAGE_TIMEOUT_MS = 2000;
const SERVER_NOW_MS = 1_700_000_000_000;
const GRACE_MS = 30_000;

/** Server clock; tests advance it explicitly. Reset before each test. */
const serverClock = { nowMs: SERVER_NOW_MS };

type FakeTimer = { callback: () => void; atMs: number; cancelled: boolean };

/** Records timers instead of running them; `runDue()` fires those whose time has come. */
function createFakeScheduler() {
  const timers: FakeTimer[] = [];
  const scheduler: Scheduler = {
    setTimer: (callback, delayMs) => {
      const timer = { callback, atMs: serverClock.nowMs + delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as FakeTimer).cancelled = true;
    },
  };
  return {
    scheduler,
    pending: () => timers.filter((timer) => !timer.cancelled),
    runDue: () => {
      for (const timer of [...timers]) {
        if (!timer.cancelled && timer.atMs <= serverClock.nowMs) {
          timer.cancelled = true;
          timer.callback();
        }
      }
    },
  };
}
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

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + MESSAGE_TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

type TestClient = {
  socket: WebSocket;
  send: (message: unknown) => void;
  sendRaw: (data: string) => void;
  next: () => Promise<ServerMessage>;
  close: () => Promise<void>;
  /** Resolves with the close code once the server closes this socket. */
  closed: Promise<number>;
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

  const closed = new Promise<number>((resolve) => {
    socket.once("close", (code) => resolve(code));
  });
  await once(socket, "open");

  return {
    socket,
    closed,
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
  let fakeScheduler: ReturnType<typeof createFakeScheduler>;
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
      hostId: created.selfId,
      viewerId: joined.selfId,
      hostToken: created.resumeToken,
      viewerToken: joined.resumeToken,
    };
  }

  function resumeMessage(roomId: string, resumeToken: string) {
    return { type: "room.resume", protocolVersion: ProtocolVersion, roomId, resumeToken };
  }

  /** hostAndViewer, plus shared media; the media snapshots are consumed. */
  async function roomWithMedia() {
    const room = await hostAndViewer();
    room.host.send(mediaSet(media));
    await room.host.next();
    await room.viewer.next();
    return room;
  }

  /** Heartbeat is off by default so tests control every scheduled timer. */
  async function startServer(heartbeatIntervalMs = 0): Promise<void> {
    fakeScheduler = createFakeScheduler();
    coordination = createCoordinationServer({
      now: () => serverClock.nowMs,
      graceMs: GRACE_MS,
      scheduler: fakeScheduler.scheduler,
      heartbeatIntervalMs,
    });
    coordination.server.listen(0, "127.0.0.1");
    await once(coordination.server, "listening");
    const { port } = coordination.server.address() as AddressInfo;
    url = `ws://127.0.0.1:${port}/ws`;
  }

  async function stopServer(): Promise<void> {
    await Promise.all(clients.splice(0).map((created) => created.close()));
    for (const socket of coordination.wss.clients) {
      socket.terminate();
    }
    coordination.wss.close();
    await new Promise<void>((resolve, reject) => {
      coordination.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  beforeEach(async () => {
    serverClock.nowMs = SERVER_NOW_MS;
    await startServer();
  });

  afterEach(stopServer);

  it("gives two clients the same participant state", async () => {
    const ada = await client();
    ada.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });
    const created = await ada.next();
    expect(created.type).toBe("room.joined");
    if (created.type !== "room.joined") return;
    expect(created.snapshot.participants).toEqual([
      { id: created.selfId, displayName: "Ada", connected: true },
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
      { id: created.selfId, displayName: "Ada", connected: true },
      { id: joined.selfId, displayName: "Grace", connected: true },
    ]);
    expect(update.snapshot).toEqual(joined.snapshot);
    expect(update.snapshot).not.toHaveProperty("resumeToken");
    expect(JSON.stringify(update)).not.toContain(joined.resumeToken);
  });

  it("keeps a disconnected participant in the room, marked not connected", async () => {
    const { host, viewer, roomId, hostId, viewerId } = await hostAndViewer();

    await viewer.close();

    expect(await host.next()).toEqual({
      type: "room.snapshot",
      snapshot: {
        roomId,
        hostId,
        participants: [
          { id: hostId, displayName: "Ada", connected: true },
          { id: viewerId, displayName: "Grace", connected: false },
        ],
        media: null,
        playback: initialPlayback,
        subtitle: null,
      },
    });
  });

  it("keeps a disconnected host as host until the grace period ends, then transfers once", async () => {
    const { host, viewer, roomId, viewerId } = await hostAndViewer();

    await host.close();
    expect(await viewer.next()).toMatchObject({
      type: "room.snapshot",
      snapshot: { hostId: expect.not.stringMatching(viewerId) },
    });

    serverClock.nowMs += GRACE_MS - 1;
    fakeScheduler.runDue();
    serverClock.nowMs += 1;
    fakeScheduler.runDue();

    expect(await viewer.next()).toEqual({
      type: "room.snapshot",
      snapshot: {
        roomId,
        hostId: viewerId,
        participants: [{ id: viewerId, displayName: "Grace", connected: true }],
        media: null,
        playback: initialPlayback,
        subtitle: null,
      },
    });
    expect(fakeScheduler.pending()).toHaveLength(0);
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

  describe("session resume", () => {
    it("restores the same participant within the grace period and tells the others", async () => {
      const { host, viewer, roomId, hostId, viewerId, viewerToken } = await hostAndViewer();
      await viewer.close();
      await host.next();
      serverClock.nowMs += 10_000;

      const returning = await client();
      returning.send(resumeMessage(roomId, viewerToken));

      expect(await returning.next()).toEqual({
        type: "room.resumed",
        selfId: viewerId,
        snapshot: {
          roomId,
          hostId,
          participants: [
            { id: hostId, displayName: "Ada", connected: true },
            { id: viewerId, displayName: "Grace", connected: true },
          ],
          media: null,
          playback: initialPlayback,
          subtitle: null,
        },
      });
      expect(await host.next()).toMatchObject({
        type: "room.snapshot",
        snapshot: { participants: [{ connected: true }, { connected: true }] },
      });

      // The old deadline no longer removes them.
      serverClock.nowMs += GRACE_MS;
      fakeScheduler.runDue();
      host.send(mediaSet(media));
      expect(await host.next()).toMatchObject({
        type: "room.snapshot",
        snapshot: { participants: [{ id: hostId }, { id: viewerId }], media },
      });
    });

    it("lets a host resume and keep host authority", async () => {
      const { host, viewer, roomId, hostId, hostToken } = await hostAndViewer();
      await host.close();
      await viewer.next();

      const returning = await client();
      returning.send(resumeMessage(roomId, hostToken));
      expect(await returning.next()).toMatchObject({
        type: "room.resumed",
        selfId: hostId,
        snapshot: { hostId },
      });
      await viewer.next();

      returning.send(mediaSet(media));
      expect(await returning.next()).toMatchObject({
        type: "room.snapshot",
        snapshot: { media },
      });
    });

    it("gives a resuming viewer the current playback timeline", async () => {
      const { host, viewer, roomId, viewerToken } = await roomWithMedia();
      host.send(playbackSet("playing", 42));
      await host.next();
      await viewer.next();
      await viewer.close();
      await host.next();
      serverClock.nowMs += 5000;

      const returning = await client();
      returning.send(resumeMessage(roomId, viewerToken));

      expect(await returning.next()).toMatchObject({
        type: "room.resumed",
        snapshot: {
          media,
          playback: {
            status: "playing",
            positionSeconds: 42,
            updatedAtServerMs: SERVER_NOW_MS,
          },
        },
      });
    });

    it("rejects an unknown token without revealing it", async () => {
      const { viewer, roomId, viewerToken } = await hostAndViewer();
      await viewer.close();
      const wrongToken = `${viewerToken.slice(0, -1)}${viewerToken.endsWith("A") ? "B" : "A"}`;

      const intruder = await client();
      intruder.send(resumeMessage(roomId, wrongToken));

      const reply = await intruder.next();
      expect(reply).toMatchObject({ type: "error", code: "resume_rejected" });
      expect(JSON.stringify(reply)).not.toContain(wrongToken);
    });

    it("rejects a resume after the grace period has expired", async () => {
      const { host, viewer, roomId, viewerToken } = await hostAndViewer();
      await viewer.close();
      await host.next();
      serverClock.nowMs += GRACE_MS;
      fakeScheduler.runDue();
      await host.next();

      const returning = await client();
      returning.send(resumeMessage(roomId, viewerToken));

      expect(await returning.next()).toMatchObject({ type: "error", code: "resume_rejected" });
    });

    it("resolves a resume at the deadline as expired even before the wake-up fires", async () => {
      const { host, viewer, roomId, viewerToken } = await hostAndViewer();
      await viewer.close();
      await host.next();
      serverClock.nowMs += GRACE_MS;

      const returning = await client();
      returning.send(resumeMessage(roomId, viewerToken));

      expect(await returning.next()).toMatchObject({ type: "error", code: "resume_rejected" });
      expect(await host.next()).toMatchObject({
        type: "room.snapshot",
        snapshot: { participants: [{ displayName: "Ada" }] },
      });
    });

    it("hands the session to the newest connection and closes the old one", async () => {
      const { host, viewer, roomId, viewerId, viewerToken } = await hostAndViewer();

      const duplicate = await client();
      duplicate.send(resumeMessage(roomId, viewerToken));

      expect(await duplicate.next()).toMatchObject({ type: "room.resumed", selfId: viewerId });
      expect(await viewer.next()).toMatchObject({ type: "error", code: "session_replaced" });
      expect(await viewer.closed).toBe(SESSION_REPLACED_CLOSE_CODE);

      // The old socket closing must not disconnect the participant: if it had,
      // a "not connected" snapshot would reach the host before this one.
      host.send(mediaSet(media));
      expect(await host.next()).toMatchObject({
        type: "room.snapshot",
        snapshot: {
          participants: [{ connected: true }, { id: viewerId, connected: true }],
          media,
        },
      });
      expect(await duplicate.next()).toMatchObject({ type: "room.snapshot", snapshot: { media } });
      expect(fakeScheduler.pending()).toHaveLength(0);
    });

    it("rejects a resume on a connection that is already in a room", async () => {
      const { host, roomId, viewerToken } = await hostAndViewer();

      host.send(resumeMessage(roomId, viewerToken));

      expect(await host.next()).toMatchObject({ type: "error", code: "already_in_room" });
    });
  });

  describe("leave and expiry", () => {
    it("removes a participant who leaves immediately and transfers host", async () => {
      const { host, viewer, viewerId } = await hostAndViewer();

      host.send({ type: "room.leave", protocolVersion: ProtocolVersion });

      expect(await viewer.next()).toMatchObject({
        type: "room.snapshot",
        snapshot: {
          hostId: viewerId,
          participants: [{ id: viewerId, connected: true }],
        },
      });
      // Closing the socket afterwards changes nothing.
      await host.close();
      expect(fakeScheduler.pending()).toHaveLength(0);
    });

    it("cannot resume after leaving", async () => {
      const { host, viewer, roomId, hostToken } = await hostAndViewer();
      host.send({ type: "room.leave", protocolVersion: ProtocolVersion });
      await viewer.next();

      const returning = await client();
      returning.send(resumeMessage(roomId, hostToken));

      expect(await returning.next()).toMatchObject({ type: "error", code: "resume_rejected" });
    });

    it("deletes the room after every participant has expired", async () => {
      const { host, viewer, roomId } = await hostAndViewer();
      await viewer.close();
      await host.next();
      await host.close();
      // Nobody is left to receive a broadcast, so wait for the server to
      // register the host's disconnect (its wake-up gets scheduled).
      await waitFor(() => fakeScheduler.pending().length === 2);
      serverClock.nowMs += GRACE_MS;
      fakeScheduler.runDue();

      const late = await client();
      late.send({
        type: "room.join",
        protocolVersion: ProtocolVersion,
        roomId,
        displayName: "Linus",
      });

      expect(await late.next()).toMatchObject({ type: "error", code: "room_not_found" });
    });
  });

  describe("heartbeat", () => {
    const HEARTBEAT_MS = 15_000;

    async function tick(): Promise<void> {
      serverClock.nowMs += HEARTBEAT_MS;
      fakeScheduler.runDue();
      // Give pongs from responsive peers time to arrive before the next tick.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    it("terminates a connection that stops answering pings, starting its grace period", async () => {
      await stopServer();
      await startServer(HEARTBEAT_MS);

      const host = await client();
      host.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });
      const created = await host.next();
      if (created.type !== "room.joined") throw new Error("expected room.joined");

      // A peer that never answers pings, like a half-open connection.
      const silentSocket = new WebSocket(url, { autoPong: false });
      await once(silentSocket, "open");
      silentSocket.send(
        JSON.stringify({
          type: "room.join",
          protocolVersion: ProtocolVersion,
          roomId: created.snapshot.roomId,
          displayName: "Grace",
        }),
      );
      await host.next();

      await tick();
      await tick();

      expect(await host.next()).toMatchObject({
        type: "room.snapshot",
        snapshot: {
          participants: [
            { displayName: "Ada", connected: true },
            { displayName: "Grace", connected: false },
          ],
        },
      });
      silentSocket.terminate();
    });

    it("keeps connections that answer pings", async () => {
      await stopServer();
      await startServer(HEARTBEAT_MS);
      const host = await client();
      host.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });
      await host.next();

      await tick();
      await tick();
      await tick();

      host.send(clockPing(7));
      expect(await host.next()).toMatchObject({ type: "clock.pong", id: 7 });
      expect(host.socket.readyState).toBe(WebSocket.OPEN);
    });
  });

  it("rejects creating a second room on the same connection", async () => {
    const ada = await client();
    ada.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });
    await ada.next();

    ada.send({ type: "room.create", protocolVersion: ProtocolVersion, displayName: "Ada" });

    expect(await ada.next()).toMatchObject({ type: "error", code: "already_in_room" });
  });

  describe("shared subtitles", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSecret cue text\n";

    function subtitleSet(fields: Record<string, unknown> = {}) {
      return {
        type: "subtitle.set",
        protocolVersion: ProtocolVersion,
        name: "movie.en.srt",
        content: vtt,
        mediaMagnetUri: media.magnetUri,
        ...fields,
      };
    }

    function subtitleRemove(id: string) {
      return { type: "subtitle.remove", protocolVersion: ProtocolVersion, id };
    }

    /** Next message, which must be a snapshot; returns its subtitle metadata. */
    async function nextSubtitleMetadata(client: TestClient) {
      const message = await client.next();
      if (message.type !== "room.snapshot") {
        throw new Error(`expected room.snapshot, got ${message.type}`);
      }
      expect(JSON.stringify(message)).not.toContain("Secret cue text");
      return message.snapshot.subtitle;
    }

    it("sends everyone the metadata snapshot, then the matching content", async () => {
      const { host, viewer, viewerId } = await roomWithMedia();

      viewer.send(subtitleSet());

      for (const participant of [host, viewer]) {
        const metadata = await nextSubtitleMetadata(participant);
        expect(metadata).toEqual({
          id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
          name: "movie.en.srt",
          sizeBytes: vtt.length,
          sharedBy: viewerId,
        });
        expect(await participant.next()).toEqual({
          type: "subtitle.content",
          id: metadata?.id,
          content: vtt,
        });
      }
    });

    it("gives late joiners the metadata and then the matching content", async () => {
      const { host, viewer, roomId } = await roomWithMedia();
      host.send(subtitleSet());
      const metadata = await nextSubtitleMetadata(viewer);
      await viewer.next();

      const late = await client();
      late.send({ type: "room.join", protocolVersion: ProtocolVersion, roomId, displayName: "Linus" });

      const joined = await late.next();
      expect(joined).toMatchObject({ type: "room.joined", snapshot: { subtitle: metadata } });
      expect(JSON.stringify(joined)).not.toContain("Secret cue text");
      expect(await late.next()).toEqual({ type: "subtitle.content", id: metadata?.id, content: vtt });
    });

    it("sends the content again to a participant who resumes", async () => {
      const { host, viewer, roomId, viewerToken } = await roomWithMedia();
      host.send(subtitleSet());
      const metadata = await nextSubtitleMetadata(viewer);
      await viewer.next();
      await viewer.close();

      const returning = await client();
      returning.send(resumeMessage(roomId, viewerToken));

      expect(await returning.next()).toMatchObject({
        type: "room.resumed",
        snapshot: { subtitle: metadata },
      });
      expect(await returning.next()).toEqual({
        type: "subtitle.content",
        id: metadata?.id,
        content: vtt,
      });
    });

    it("sends no content to joiners when there is no subtitle", async () => {
      const { roomId } = await roomWithMedia();

      const late = await client();
      late.send({ type: "room.join", protocolVersion: ProtocolVersion, roomId, displayName: "Linus" });
      await late.next();
      late.send(clockPing(1));

      expect(await late.next()).toMatchObject({ type: "clock.pong", id: 1 });
    });

    it("converges on the last of two nearly simultaneous subtitles", async () => {
      const { host, viewer } = await roomWithMedia();

      host.send(subtitleSet({ name: "first.srt" }));
      viewer.send(subtitleSet({ name: "second.srt" }));

      const seen: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const message = await host.next();
        seen.push(message.type === "room.snapshot" ? `meta:${message.snapshot.subtitle?.name}` : message.type);
      }
      expect(seen).toEqual([
        "meta:first.srt",
        "subtitle.content",
        "meta:second.srt",
        "subtitle.content",
      ]);
    });

    it("removes only the subtitle the sender saw", async () => {
      const { host, viewer } = await roomWithMedia();
      host.send(subtitleSet({ name: "first.srt" }));
      const first = await nextSubtitleMetadata(viewer);
      await viewer.next();
      viewer.send(subtitleSet({ name: "second.srt" }));
      const second = await nextSubtitleMetadata(viewer);
      await viewer.next();
      await host.next();
      await host.next();
      await host.next();
      await host.next();

      // A stale remove of the first subtitle is ignored, without a broadcast.
      host.send(subtitleRemove(first!.id));
      host.send(clockPing(1));
      expect(await host.next()).toMatchObject({ type: "clock.pong", id: 1 });

      host.send(subtitleRemove(second!.id));
      expect(await nextSubtitleMetadata(host)).toBeNull();
      expect(await nextSubtitleMetadata(viewer)).toBeNull();
    });

    it("clears the subtitle when the host shares new media", async () => {
      const { host, viewer } = await roomWithMedia();
      host.send(subtitleSet());
      await nextSubtitleMetadata(viewer);
      await viewer.next();

      host.send(
        mediaSet({
          ...media,
          magnetUri: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
        }),
      );

      expect(await nextSubtitleMetadata(viewer)).toBeNull();
    });

    it("rejects a subtitle for media that changed, or with no media", async () => {
      const { host } = await hostAndViewer();
      host.send(subtitleSet());
      expect(await host.next()).toMatchObject({ type: "error", code: "no_media" });

      host.send(mediaSet(media));
      await host.next();
      host.send(
        subtitleSet({
          mediaMagnetUri: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
        }),
      );
      expect(await host.next()).toMatchObject({ type: "error", code: "media_changed" });
    });

    it("rejects subtitle commands from a socket whose session was replaced", async () => {
      const { viewer, roomId, viewerToken } = await roomWithMedia();
      const replacement = await client();
      replacement.send(resumeMessage(roomId, viewerToken));
      await replacement.next();
      expect(await viewer.next()).toMatchObject({ type: "error", code: "session_replaced" });

      // ws may still deliver a message sent before the close completes.
      if (viewer.socket.readyState === WebSocket.OPEN) {
        viewer.send(subtitleSet());
        expect(await viewer.next()).toMatchObject({ type: "error", code: "not_in_room" });
      }
      expect(await viewer.closed).toBe(SESSION_REPLACED_CLOSE_CODE);
    });

    it("rejects oversized content with an error that does not echo it", async () => {
      const { viewer } = await roomWithMedia();
      const content = `${vtt}${"x".repeat(512 * 1024)}\n`;

      viewer.send(subtitleSet({ content }));

      const reply = await viewer.next();
      expect(reply).toMatchObject({ type: "error", code: "invalid_message" });
      expect(JSON.stringify(reply)).not.toContain("Secret cue text");
      expect(viewer.socket.readyState).toBe(WebSocket.OPEN);
    });

    it("closes the connection for a frame over the payload limit, keeping the room", async () => {
      const { host, viewer } = await roomWithMedia();

      viewer.sendRaw("x".repeat(MAX_MESSAGE_BYTES + 1));

      expect(await viewer.closed).toBe(1009);
      expect(await host.next()).toMatchObject({
        type: "room.snapshot",
        snapshot: { participants: [{ connected: true }, { connected: false }] },
      });
    });
  });
});
