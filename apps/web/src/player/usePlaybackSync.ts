import {
  APPLY_SEEK_THRESHOLD_SECONDS,
  DRIFT_SEEK_THRESHOLD_SECONDS,
  expectedPositionSeconds,
  planCorrection,
} from "@swarmcue/playback-sync";
import type { PlaybackState, PlaybackStatus } from "@swarmcue/protocol";
import { useEffect, useRef, useState, type RefObject } from "react";

/** How often a playing client compares its position with the room. */
const DRIFT_CHECK_INTERVAL_MS = 1000;
/** Minimum time between corrective seeks, so a seek can settle first. */
const CORRECTION_COOLDOWN_MS = 3000;

export type LocalPlaybackChange = {
  status: PlaybackStatus;
  positionSeconds: number;
};

export type PlaybackSyncOptions = {
  /**
   * Changes when the room connection is (re-)established. Room state is
   * re-applied then even if its revision is unchanged, so local changes made
   * while disconnected are reverted.
   */
  resyncKey: number | null;
  /** Estimated current server time in epoch ms. */
  getServerNowMs: () => number;
  /** Called when this user plays, pauses, or seeks. */
  onLocalChange: (change: LocalPlaybackChange) => void;
};

export type PlaybackSync = {
  /** The browser refused to start playback without a user gesture. */
  blocked: boolean;
};

function knownDuration(video: HTMLVideoElement): number | null {
  return Number.isFinite(video.duration) ? video.duration : null;
}

/**
 * Browsers pause or resume media on their own (e.g. Chrome pauses muted,
 * gesture-less playback when it is offscreen). Those changes carry no user
 * gesture and must not become room commands. Without the API, assume a user.
 */
function hasRecentUserGesture(): boolean {
  return "userActivation" in navigator ? navigator.userActivation.isActive : true;
}

/**
 * Keeps a <video> element on the room's playback timeline.
 *
 * - Room state is applied when its revision changes or a new element mounts
 *   (each `src` gets a fresh element): seek to the expected position if it is
 *   off by more than a small threshold, then play or pause.
 * - While the room is playing, the position is re-checked every second and
 *   corrected by seeking when it drifts too far. Checks are skipped while
 *   seeking or buffering, and corrections have a cooldown.
 * - play/pause/seeked events caused by this hook are ignored. Other ones are
 *   reported via `onLocalChange` only if they follow a user gesture (or the
 *   video reached its end). Pressing play while the room is already playing
 *   just catches up instead of restarting the room.
 */
export function usePlaybackSync(
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string | null,
  playback: PlaybackState | null,
  { resyncKey, getServerNowMs, onLocalChange }: PlaybackSyncOptions,
): PlaybackSync {
  const [blocked, setBlocked] = useState(false);
  /** Status we are applying from the room; its matching event is not re-sent. */
  const expectedStatusRef = useRef<PlaybackStatus | null>(null);
  /** True while a seek started by this hook is in flight. */
  const programmaticSeekRef = useRef(false);
  const lastCorrectionAtRef = useRef(Number.NEGATIVE_INFINITY);

  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const getServerNowMsRef = useRef(getServerNowMs);
  getServerNowMsRef.current = getServerNowMs;
  const onLocalChangeRef = useRef(onLocalChange);
  onLocalChangeRef.current = onLocalChange;

  /** Seek to the room's expected position when off by more than `thresholdSeconds`. */
  function correctPosition(video: HTMLVideoElement, thresholdSeconds: number): void {
    const current = playbackRef.current;
    // Before metadata, setting currentTime fires no `seeked`, which would leave
    // programmaticSeekRef stuck; the loadedmetadata handler corrects instead.
    if (!current || video.readyState === HTMLMediaElement.HAVE_NOTHING) {
      return;
    }
    const correction = planCorrection({
      expectedSeconds: expectedPositionSeconds(current, getServerNowMsRef.current()),
      actualSeconds: video.currentTime,
      thresholdSeconds,
      durationSeconds: knownDuration(video),
    });
    if (correction.kind === "seek") {
      programmaticSeekRef.current = true;
      lastCorrectionAtRef.current = performance.now();
      video.currentTime = correction.toSeconds;
    }
  }

  useEffect(() => {
    expectedStatusRef.current = null;
    programmaticSeekRef.current = false;
    setBlocked(false);
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const report = (status: PlaybackStatus) => {
      onLocalChangeRef.current({ status, positionSeconds: video.currentTime });
    };

    const handlePlay = () => {
      setBlocked(false);
      if (expectedStatusRef.current === "playing") {
        expectedStatusRef.current = null;
        return;
      }
      const room = playbackRef.current;
      if (!room) {
        return;
      }
      // e.g. after blocked autoplay: rejoin the room instead of restarting it.
      if (room.status === "playing") {
        correctPosition(video, APPLY_SEEK_THRESHOLD_SECONDS);
        return;
      }
      if (!hasRecentUserGesture()) {
        // The browser resumed playback on its own; the room is paused.
        expectedStatusRef.current = "paused";
        video.pause();
        return;
      }
      report("playing");
    };

    const handlePause = () => {
      if (expectedStatusRef.current === "paused") {
        expectedStatusRef.current = null;
        return;
      }
      if (playbackRef.current?.status !== "playing") {
        return;
      }
      // Reaching the end pauses the room too. Any other pause without a user
      // gesture stays local; pressing play rejoins the room.
      if (video.ended || hasRecentUserGesture()) {
        report("paused");
      }
    };

    // A seek keeps the room's status and only moves the position.
    const handleSeeked = () => {
      if (programmaticSeekRef.current) {
        programmaticSeekRef.current = false;
        return;
      }
      const room = playbackRef.current;
      if (room && hasRecentUserGesture()) {
        report(room.status);
      }
    };

    // A new element may not accept a position until its metadata is known.
    const handleLoadedMetadata = () => {
      correctPosition(video, APPLY_SEEK_THRESHOLD_SECONDS);
    };

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [videoRef, src]);

  const status = playback?.status ?? null;
  const revision = playback?.revision ?? null;

  // Apply each new room revision, and the current one after every (re)connect.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || status === null) {
      return;
    }

    correctPosition(video, APPLY_SEEK_THRESHOLD_SECONDS);

    if (status === "paused") {
      setBlocked(false);
      if (!video.paused) {
        expectedStatusRef.current = "paused";
        video.pause();
      }
      return;
    }

    if (video.paused) {
      expectedStatusRef.current = "playing";
      video.play().catch((error: unknown) => {
        expectedStatusRef.current = null;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          setBlocked(true);
        }
        // AbortError means a pause interrupted play(); nothing to do.
      });
    }
  }, [videoRef, src, status, revision, resyncKey]);

  // Drift correction while the room is playing.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || status !== "playing") {
      return;
    }

    const interval = window.setInterval(() => {
      if (
        video.paused ||
        video.seeking ||
        programmaticSeekRef.current ||
        video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ||
        performance.now() - lastCorrectionAtRef.current < CORRECTION_COOLDOWN_MS
      ) {
        return;
      }
      correctPosition(video, DRIFT_SEEK_THRESHOLD_SECONDS);
    }, DRIFT_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [videoRef, src, status, revision]);

  return { blocked };
}
