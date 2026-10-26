import { CLOCK_PING_ID_MAX } from "@swarmcue/protocol";
import {
  computeClockSample,
  estimateServerTimeMs,
  selectBestSample,
  type ClockSample,
} from "./clockEstimate.js";

const DEFAULT_SAMPLES_PER_ROUND = 5;
const DEFAULT_SAMPLE_TIMEOUT_MS = 2000;
const DEFAULT_RESYNC_INTERVAL_MS = 45_000;

type TimerHandle = ReturnType<typeof setTimeout>;

export type ClockSyncOptions = {
  sendPing: (id: number) => void;
  monotonicNow?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  samplesPerRound?: number;
  /** How long to wait for each pong; also the largest round trip accepted. */
  sampleTimeoutMs?: number;
  resyncIntervalMs?: number;
};

export type ClockSync = {
  handlePong: (pong: { id: number; serverTimeMs: number }) => void;
  /** Estimated server epoch ms, or null until a round has produced a sample. */
  estimateServerNowMs: () => number | null;
  /** Start a measurement round now, unless one is already running. */
  resyncNow: () => void;
  /** Stop timers and ignore any later pongs. The session cannot be restarted. */
  dispose: () => void;
};

type PendingPing = {
  id: number;
  sentAtMonotonicMs: number;
  timeout: TimerHandle;
};

/**
 * One clock-estimation session for one connection. Starts a round right
 * away, then re-measures every `resyncIntervalMs`.
 *
 * Pings within a round are sent one at a time, so they never queue behind
 * each other and inflate the measured round trip. A pong counts only if its
 * id matches the single pending ping; unknown, duplicate, and late pongs are
 * ignored. Failures are logged and never thrown.
 */
export function startClockSync(options: ClockSyncOptions): ClockSync {
  const {
    sendPing,
    monotonicNow = () => performance.now(),
    setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer = (handle) => clearTimeout(handle),
    samplesPerRound = DEFAULT_SAMPLES_PER_ROUND,
    sampleTimeoutMs = DEFAULT_SAMPLE_TIMEOUT_MS,
    resyncIntervalMs = DEFAULT_RESYNC_INTERVAL_MS,
  } = options;

  let disposed = false;
  let estimate: ClockSample | null = null;
  /** Samples collected by the running round; null when no round is running. */
  let roundSamples: ClockSample[] | null = null;
  let pingsLeftInRound = 0;
  let pending: PendingPing | null = null;
  let resyncTimer: TimerHandle | null = null;
  let nextId = 0;

  function allocateId(): number {
    const id = nextId;
    nextId = id >= CLOCK_PING_ID_MAX ? 0 : id + 1;
    return id;
  }

  function startRound(): void {
    if (disposed || roundSamples) {
      return;
    }
    if (resyncTimer !== null) {
      clearTimer(resyncTimer);
      resyncTimer = null;
    }
    roundSamples = [];
    pingsLeftInRound = samplesPerRound;
    sendNextPing();
  }

  function sendNextPing(): void {
    // A loop rather than recursion so repeated send failures stay flat.
    while (!disposed && roundSamples) {
      if (pingsLeftInRound === 0) {
        finishRound();
        return;
      }
      pingsLeftInRound -= 1;

      const id = allocateId();
      const timeout = setTimer(() => {
        if (pending?.id === id) {
          pending = null;
          sendNextPing();
        }
      }, sampleTimeoutMs);
      // Set before sending so a synchronous reply is still matched.
      pending = { id, sentAtMonotonicMs: monotonicNow(), timeout };

      try {
        sendPing(id);
        return;
      } catch (error) {
        console.error("Failed to send clock ping:", error);
        clearTimer(timeout);
        pending = null;
      }
    }
  }

  function finishRound(): void {
    const best = roundSamples ? selectBestSample(roundSamples) : null;
    roundSamples = null;
    // A round with no valid samples keeps the previous estimate.
    if (best) {
      estimate = best;
    }
    resyncTimer = setTimer(() => {
      resyncTimer = null;
      startRound();
    }, resyncIntervalMs);
  }

  startRound();

  return {
    handlePong(pong) {
      if (disposed || !roundSamples || !pending || pong.id !== pending.id) {
        return;
      }
      const receivedAtMonotonicMs = monotonicNow();
      const { sentAtMonotonicMs, timeout } = pending;
      clearTimer(timeout);
      pending = null;

      const sample = computeClockSample({
        sentAtMonotonicMs,
        receivedAtMonotonicMs,
        serverTimeMs: pong.serverTimeMs,
        maxRoundTripMs: sampleTimeoutMs,
      });
      if (sample) {
        roundSamples.push(sample);
      }
      sendNextPing();
    },

    estimateServerNowMs() {
      return estimate ? estimateServerTimeMs(estimate, monotonicNow()) : null;
    },

    resyncNow() {
      startRound();
    },

    dispose() {
      disposed = true;
      if (pending) {
        clearTimer(pending.timeout);
        pending = null;
      }
      if (resyncTimer !== null) {
        clearTimer(resyncTimer);
        resyncTimer = null;
      }
      roundSamples = null;
      estimate = null;
    },
  };
}
