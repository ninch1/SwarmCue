/**
 * Pure playback-position math shared by the coordination server and the web
 * client. No clocks are read here; callers pass the server time they have
 * (the server's own clock, or the client's estimate of it).
 */

/** The room's playback anchor: where playback was at a known server time. */
export type PlaybackAnchor = {
  status: "playing" | "paused";
  positionSeconds: number;
  updatedAtServerMs: number;
};

/** A client applying a new room revision re-seeks only beyond this gap. */
export const APPLY_SEEK_THRESHOLD_SECONDS = 0.25;
/** While playing, a client corrects drift only beyond this gap. */
export const DRIFT_SEEK_THRESHOLD_SECONDS = 0.5;
/** The server treats a command this close to the current timeline as a no-op. */
export const UNCHANGED_POSITION_TOLERANCE_SECONDS = 0.25;

/**
 * Where playback should be at `serverNowMs`. While paused the position is
 * fixed; while playing it advances in real time. Negative elapsed time (a
 * client estimate slightly behind the server) counts as zero.
 */
export function expectedPositionSeconds(
  anchor: PlaybackAnchor,
  serverNowMs: number,
): number {
  if (anchor.status === "paused") {
    return anchor.positionSeconds;
  }
  const elapsedSeconds = Math.max(0, serverNowMs - anchor.updatedAtServerMs) / 1000;
  return anchor.positionSeconds + elapsedSeconds;
}

/**
 * True when a requested status and position would not meaningfully change
 * the current timeline, e.g. a client echoing state it just applied.
 */
export function isEquivalentPlayback(
  current: PlaybackAnchor,
  requested: { status: PlaybackAnchor["status"]; positionSeconds: number },
  serverNowMs: number,
  toleranceSeconds = UNCHANGED_POSITION_TOLERANCE_SECONDS,
): boolean {
  return (
    current.status === requested.status &&
    Math.abs(expectedPositionSeconds(current, serverNowMs) - requested.positionSeconds) <=
      toleranceSeconds
  );
}

export type Correction = { kind: "none" } | { kind: "seek"; toSeconds: number };

export type CorrectionInput = {
  expectedSeconds: number;
  actualSeconds: number;
  thresholdSeconds: number;
  /** The media duration when known; the target is never past the end. */
  durationSeconds: number | null;
};

/** Decide whether the local player must seek to rejoin the room's timeline. */
export function planCorrection({
  expectedSeconds,
  actualSeconds,
  thresholdSeconds,
  durationSeconds,
}: CorrectionInput): Correction {
  const targetSeconds =
    durationSeconds !== null && Number.isFinite(durationSeconds)
      ? Math.min(expectedSeconds, durationSeconds)
      : expectedSeconds;

  if (Math.abs(actualSeconds - targetSeconds) <= thresholdSeconds) {
    return { kind: "none" };
  }
  return { kind: "seek", toSeconds: targetSeconds };
}
