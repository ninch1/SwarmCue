import {
  ClientMessageSchema,
  ProtocolVersion,
  type ClientMessage,
  type ParticipantId,
  type PlaybackStatus,
  type RoomSnapshot,
  type ServerMessage,
  type SharedMedia,
  type SubtitleId,
} from "@swarmcue/protocol";
import { estimateServerTimeMs, type ClockSample } from "../clock/clockEstimate.js";
import type { ClockSync, ClockSyncOptions } from "../clock/clockSync.js";
import type { RoomConnection, RoomConnectionHandlers } from "./connection.js";
import { RECONNECT_GIVE_UP_AFTER_MS, reconnectDelayMs } from "./reconnectBackoff.js";
import { normalizeRoomCode } from "./roomCode.js";
import type { SessionStore, StoredSession } from "./sessionStore.js";

/** Close code the server uses when another connection resumed this session. */
const SESSION_REPLACED_CLOSE_CODE = 4000;

/** The text of the room's shared subtitle; always the one `snapshot.subtitle` names. */
export type SharedSubtitleText = { id: SubtitleId; vtt: string };

/** This tab's latest attempt to share a subtitle with the room. */
export type SubtitleShareStatus =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "failed"; message: string };

export type InRoomState = {
  status: "in-room";
  /** While reconnecting, `snapshot` is the last known room state. */
  connection: "connected" | "reconnecting";
  selfId: ParticipantId;
  snapshot: RoomSnapshot;
  /** Increases on every successful join or resume; consumers re-apply room state. */
  resyncKey: number;
  /** Latest server error while in the room; cleared by the next snapshot. */
  error: string | null;
  /** Null until the text for `snapshot.subtitle` arrives, or when there is none. */
  sharedSubtitle: SharedSubtitleText | null;
  subtitleShare: SubtitleShareStatus;
};

export type RoomState =
  | { status: "idle"; error: string | null }
  /** Creating or joining a room. */
  | { status: "connecting" }
  /** Reclaiming a stored session after a page load; no room state yet. */
  | { status: "resuming" }
  | InRoomState;

export type SubtitleShareRequest = {
  name: string;
  /** Normalized WebVTT. */
  content: string;
  /** The room media this subtitle was chosen for. */
  mediaMagnetUri: string;
};

type TimerHandle = unknown;

export type RoomSessionDeps = {
  openConnection: (handlers: RoomConnectionHandlers) => RoomConnection;
  startClockSync: (options: ClockSyncOptions) => ClockSync;
  sessionStore: SessionStore;
  onStateChange: (state: RoomState) => void;
  setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer: (handle: TimerHandle) => void;
  random: () => number;
  /** Monotonic ms, for the give-up window and clock estimates. */
  monotonicNow: () => number;
};

export type RoomSession = {
  getState: () => RoomState;
  createRoom: (displayName: string) => void;
  joinRoom: (roomCode: string, displayName: string) => void;
  /** Resume the session stored for this tab, if any. Returns whether one was found. */
  resumeStored: () => boolean;
  /** Deliberately leave: tells the server, forgets the session, returns to idle. */
  leave: () => void;
  /** Host only. Returns a message when the command cannot be sent, otherwise null. */
  setMedia: (media: SharedMedia) => string | null;
  /** Returns a message when the command cannot be sent, otherwise null. */
  setPlayback: (status: PlaybackStatus, positionSeconds: number) => string | null;
  /** Share a subtitle with everyone. Returns a message when it cannot be sent, otherwise null. */
  setSubtitle: (request: SubtitleShareRequest) => string | null;
  /** Remove the shared subtitle `id` for everyone. Returns a message when it cannot be sent. */
  removeSubtitle: (id: SubtitleId) => string | null;
  /** Estimated server epoch ms, or null before any clock measurement. */
  estimateServerNowMs: () => number | null;
  /** Re-measure the clock now (e.g. when the tab becomes visible). */
  resyncClock: () => void;
  /** Skip the remaining backoff delay (e.g. when the browser comes back online). */
  reconnectNow: () => void;
  /** Stop all activity without forgetting the stored session (e.g. unmount). */
  dispose: () => void;
};

/** One WebSocket and its clock-estimation session. */
type Attempt = {
  connection: RoomConnection;
  clock: ClockSync | null;
  /** True once the server confirmed create/join/resume on this connection. */
  inRoom: boolean;
};

const MESSAGE_SESSION_ENDED = "This room session has ended.";
const MESSAGE_REPLACED = "This room was opened in another tab or window.";
const MESSAGE_UPDATED = "SwarmCue was updated. Reload the page to rejoin the room.";
const MESSAGE_GAVE_UP = "Couldn't reconnect to the room.";
const MESSAGE_RECONNECTING = "Reconnecting to the room…";
const MESSAGE_SHARE_INTERRUPTED = "The connection dropped before the subtitle was shared.";

const SHARE_IDLE: SubtitleShareStatus = { status: "idle" };

/**
 * Apply a new snapshot. The shared subtitle text is kept only while the
 * snapshot still names it, so a removed or replaced subtitle disappears.
 */
function withSnapshot(current: InRoomState, next: RoomSnapshot): InRoomState {
  const sharedSubtitle =
    current.sharedSubtitle && current.sharedSubtitle.id === next.subtitle?.id
      ? current.sharedSubtitle
      : null;
  let subtitleShare = current.subtitleShare;
  if (
    subtitleShare.status === "sending" &&
    next.subtitle?.sharedBy === current.selfId &&
    next.subtitle.id !== current.snapshot.subtitle?.id
  ) {
    subtitleShare = SHARE_IDLE;
  } else if (
    subtitleShare.status === "failed" &&
    next.media?.magnetUri !== current.snapshot.media?.magnetUri
  ) {
    // The failure was about media that is gone.
    subtitleShare = SHARE_IDLE;
  }
  return { ...current, snapshot: next, sharedSubtitle, subtitleShare, error: null };
}

/** Returns the validated message, or the first validation message as a string. */
function validateClientMessage(rawMessage: unknown, fallback: string): ClientMessage | string {
  const parsed = ClientMessageSchema.safeParse(rawMessage);
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? fallback;
  }
  return parsed.data;
}

/**
 * Owns the room connection lifecycle outside React:
 *
 * - create/join open a connection; `room.joined` stores the resume session;
 * - an unexpected close keeps the last room state ("reconnecting") and
 *   retries `room.resume` with capped exponential backoff and jitter;
 * - each connection starts a new clock-estimation session, seeded with the
 *   previous estimate until it measures its own;
 * - terminal outcomes (session rejected, replaced by another tab, protocol
 *   update, giving up) end the session with a message.
 */
export function createRoomSession(deps: RoomSessionDeps): RoomSession {
  let state: RoomState = { status: "idle", error: null };
  let attempt: Attempt | null = null;
  /** The session this tab owns; kept in memory and mirrored to storage. */
  let session: StoredSession | null = null;
  let retryTimer: TimerHandle | null = null;
  let retryCount = 0;
  let reconnectStartedAt = 0;
  /** Latest clock sample, carried across connections. */
  let lastClockSample: ClockSample | null = null;
  let nextResyncKey = 1;

  function setState(next: RoomState): void {
    state = next;
    deps.onStateChange(next);
  }

  function cancelRetry(): void {
    if (retryTimer !== null) {
      deps.clearTimer(retryTimer);
      retryTimer = null;
    }
  }

  /** Stops the current connection and its clock, keeping the last clock sample. */
  function dropAttempt(): void {
    const current = attempt;
    attempt = null;
    if (!current) {
      return;
    }
    if (current.clock) {
      lastClockSample = current.clock.currentSample() ?? lastClockSample;
      current.clock.dispose();
    }
    current.connection.close();
  }

  function forgetSession(): void {
    session = null;
    deps.sessionStore.clear();
  }

  /** A terminal outcome: stop reconnecting and show `message` on the entry screen. */
  function endSession(message: string, { keepStored = false } = {}): void {
    cancelRetry();
    dropAttempt();
    if (keepStored) {
      session = null;
    } else {
      forgetSession();
    }
    setState({ status: "idle", error: message });
  }

  function enterRoom(selfId: ParticipantId, snapshot: RoomSnapshot): void {
    retryCount = 0;
    // A resume into the same room keeps what is still valid; the server
    // sends the subtitle text again anyway, which is then ignored.
    const previous =
      state.status === "in-room" && state.snapshot.roomId === snapshot.roomId ? state : null;
    let subtitleShare = previous?.subtitleShare ?? SHARE_IDLE;
    if (subtitleShare.status === "sending") {
      subtitleShare =
        snapshot.subtitle?.sharedBy === selfId &&
        snapshot.subtitle.id !== previous?.snapshot.subtitle?.id
          ? SHARE_IDLE
          : { status: "failed", message: MESSAGE_SHARE_INTERRUPTED };
    }
    setState({
      status: "in-room",
      connection: "connected",
      selfId,
      snapshot,
      resyncKey: nextResyncKey++,
      error: null,
      sharedSubtitle:
        previous?.sharedSubtitle && previous.sharedSubtitle.id === snapshot.subtitle?.id
          ? previous.sharedSubtitle
          : null,
      subtitleShare,
    });
  }

  /**
   * Opens a connection that sends `firstMessage` once open. Callbacks from
   * a connection that is no longer current are ignored.
   */
  function open(
    firstMessage: ClientMessage,
    handlers: {
      onMessage: (current: Attempt, message: ServerMessage) => void;
      onClose: (current: Attempt, code: number) => void;
    },
  ): void {
    dropAttempt();
    const current: Attempt = {
      connection: deps.openConnection({
        onOpen: () => {
          if (attempt !== current) {
            return;
          }
          current.connection.send(firstMessage);
          current.clock = deps.startClockSync({
            sendPing: (id) => {
              current.connection.send({
                type: "clock.ping",
                protocolVersion: ProtocolVersion,
                id,
              });
            },
            initialEstimate: lastClockSample,
          });
        },
        onMessage: (message) => {
          if (attempt !== current) {
            return;
          }
          if (message.type === "clock.pong") {
            current.clock?.handlePong(message);
            return;
          }
          handlers.onMessage(current, message);
        },
        onClose: (code) => {
          if (attempt !== current) {
            return;
          }
          if (current.clock) {
            lastClockSample = current.clock.currentSample() ?? lastClockSample;
            current.clock.dispose();
            current.clock = null;
          }
          attempt = null;
          handlers.onClose(current, code);
        },
      }),
      clock: null,
      inRoom: false,
    };
    attempt = current;
  }

  /** Messages common to every connection that is in a room. */
  function handleInRoomMessage(message: ServerMessage): void {
    switch (message.type) {
      case "room.snapshot":
        if (state.status === "in-room") {
          setState(withSnapshot(state, message.snapshot));
        }
        return;
      case "subtitle.content":
        // Only the text the latest snapshot names; a stale or early one is
        // ignored, and a repeat (e.g. after resuming) changes nothing.
        if (
          state.status === "in-room" &&
          state.snapshot.subtitle?.id === message.id &&
          state.sharedSubtitle?.id !== message.id
        ) {
          setState({ ...state, sharedSubtitle: { id: message.id, vtt: message.content } });
        }
        return;
      case "error":
        if (message.code === "session_replaced") {
          endSession(MESSAGE_REPLACED);
          return;
        }
        if (state.status === "in-room") {
          // The server answers a subtitle.set with an error or the new snapshot.
          if (state.subtitleShare.status === "sending") {
            setState({
              ...state,
              subtitleShare: { status: "failed", message: message.message },
            });
          } else {
            setState({ ...state, error: message.message });
          }
        }
        return;
      default:
        return;
    }
  }

  function handleUnexpectedClose(code: number): void {
    if (code === SESSION_REPLACED_CLOSE_CODE) {
      endSession(MESSAGE_REPLACED);
      return;
    }
    if (!session) {
      setState({ status: "idle", error: "Disconnected from the room server." });
      return;
    }
    if (state.status === "in-room") {
      setState({ ...state, connection: "reconnecting" });
    }
    reconnectStartedAt = deps.monotonicNow();
    retryCount = 0;
    scheduleResume();
  }

  function scheduleResume(): void {
    cancelRetry();
    if (deps.monotonicNow() - reconnectStartedAt >= RECONNECT_GIVE_UP_AFTER_MS) {
      endSession(MESSAGE_GAVE_UP);
      return;
    }
    const delayMs = reconnectDelayMs(retryCount, deps.random);
    retryCount += 1;
    retryTimer = deps.setTimer(() => {
      retryTimer = null;
      resume();
    }, delayMs);
  }

  function resume(): void {
    if (!session) {
      return;
    }
    open(
      {
        type: "room.resume",
        protocolVersion: ProtocolVersion,
        roomId: session.roomId,
        resumeToken: session.resumeToken,
      },
      {
        onMessage: (current, message) => {
          if (current.inRoom) {
            handleInRoomMessage(message);
            return;
          }
          switch (message.type) {
            case "room.resumed":
              current.inRoom = true;
              enterRoom(message.selfId, message.snapshot);
              return;
            case "error":
              if (message.code === "unsupported_version") {
                endSession(MESSAGE_UPDATED, { keepStored: true });
              } else if (message.code === "session_replaced") {
                endSession(MESSAGE_REPLACED);
              } else {
                // resume_rejected, or anything else: this session cannot come back.
                endSession(MESSAGE_SESSION_ENDED);
              }
              return;
            default:
              return;
          }
        },
        onClose: (current, code) => {
          if (current.inRoom) {
            handleUnexpectedClose(code);
          } else if (code === SESSION_REPLACED_CLOSE_CODE) {
            endSession(MESSAGE_REPLACED);
          } else {
            scheduleResume();
          }
        },
      },
    );
  }

  function start(rawMessage: unknown): void {
    // Validate locally first so the user gets immediate, specific feedback.
    const firstMessage = validateClientMessage(rawMessage, "Invalid room details.");
    if (typeof firstMessage === "string") {
      setState({ status: "idle", error: firstMessage });
      return;
    }

    cancelRetry();
    forgetSession();
    setState({ status: "connecting" });
    open(firstMessage, {
      onMessage: (current, message) => {
        if (current.inRoom) {
          handleInRoomMessage(message);
          return;
        }
        switch (message.type) {
          case "room.joined":
            current.inRoom = true;
            session = { roomId: message.snapshot.roomId, resumeToken: message.resumeToken };
            deps.sessionStore.save(session);
            enterRoom(message.selfId, message.snapshot);
            return;
          case "error":
            dropAttempt();
            setState({ status: "idle", error: message.message });
            return;
          default:
            return;
        }
      },
      onClose: (current, code) => {
        if (current.inRoom) {
          handleUnexpectedClose(code);
        } else {
          setState({ status: "idle", error: "Could not connect to the room server." });
        }
      },
    });
  }

  function joinedConnection(): RoomConnection | null {
    return attempt?.inRoom ? attempt.connection : null;
  }

  function sendInRoom(rawMessage: unknown, fallback: string): string | null {
    const connection = joinedConnection();
    if (!connection) {
      return state.status === "in-room" ? MESSAGE_RECONNECTING : "Join a room first.";
    }
    const message = validateClientMessage(rawMessage, fallback);
    if (typeof message === "string") {
      return message;
    }
    connection.send(message);
    return null;
  }

  return {
    getState: () => state,

    createRoom(displayName) {
      start({ type: "room.create", protocolVersion: ProtocolVersion, displayName });
    },

    joinRoom(roomCode, displayName) {
      start({
        type: "room.join",
        protocolVersion: ProtocolVersion,
        roomId: normalizeRoomCode(roomCode),
        displayName,
      });
    },

    resumeStored() {
      const stored = deps.sessionStore.load();
      if (!stored) {
        return false;
      }
      cancelRetry();
      session = stored;
      setState({ status: "resuming" });
      reconnectStartedAt = deps.monotonicNow();
      retryCount = 0;
      resume();
      return true;
    },

    leave() {
      cancelRetry();
      // The server removes us right away; if not connected, it expires us
      // after the grace period instead.
      joinedConnection()?.send({ type: "room.leave", protocolVersion: ProtocolVersion });
      dropAttempt();
      forgetSession();
      setState({ status: "idle", error: null });
    },

    setMedia(media) {
      return sendInRoom(
        { type: "media.set", protocolVersion: ProtocolVersion, media },
        "This media cannot be shared.",
      );
    },

    setPlayback(status, positionSeconds) {
      return sendInRoom(
        { type: "playback.set", protocolVersion: ProtocolVersion, status, positionSeconds },
        "Invalid playback command.",
      );
    },

    setSubtitle({ name, content, mediaMagnetUri }) {
      const error = sendInRoom(
        {
          type: "subtitle.set",
          protocolVersion: ProtocolVersion,
          name,
          content,
          mediaMagnetUri,
        },
        "This subtitle cannot be shared.",
      );
      if (state.status === "in-room") {
        setState({
          ...state,
          subtitleShare: error ? { status: "failed", message: error } : { status: "sending" },
        });
      }
      return error;
    },

    removeSubtitle(id) {
      return sendInRoom(
        { type: "subtitle.remove", protocolVersion: ProtocolVersion, id },
        "Invalid subtitle.",
      );
    },

    estimateServerNowMs() {
      const live = attempt?.clock?.estimateServerNowMs();
      if (live !== undefined && live !== null) {
        return live;
      }
      return lastClockSample
        ? estimateServerTimeMs(lastClockSample, deps.monotonicNow())
        : null;
    },

    resyncClock() {
      attempt?.clock?.resyncNow();
    },

    reconnectNow() {
      if (retryTimer === null) {
        return;
      }
      cancelRetry();
      resume();
    },

    dispose() {
      cancelRetry();
      dropAttempt();
    },
  };
}
