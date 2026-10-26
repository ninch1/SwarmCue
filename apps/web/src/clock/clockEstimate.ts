/**
 * Pure clock-offset math. The local clock is monotonic (`performance.now()`),
 * so client wall-clock jumps cannot corrupt an estimate; the server clock is
 * its epoch `Date.now()`, so the estimated server time stays transferable.
 */

export type ClockSample = {
  roundTripMs: number;
  /** Add to a local monotonic reading to get estimated server epoch ms. */
  monotonicToServerOffsetMs: number;
};

export type ClockSampleInput = {
  sentAtMonotonicMs: number;
  receivedAtMonotonicMs: number;
  serverTimeMs: number;
  maxRoundTripMs: number;
};

/**
 * Assumes the server read its clock halfway through the round trip, so the
 * error is at most half the round trip when network delay is asymmetric.
 * Returns null for samples that cannot be trusted.
 */
export function computeClockSample({
  sentAtMonotonicMs,
  receivedAtMonotonicMs,
  serverTimeMs,
  maxRoundTripMs,
}: ClockSampleInput): ClockSample | null {
  const roundTripMs = receivedAtMonotonicMs - sentAtMonotonicMs;
  if (
    !Number.isFinite(sentAtMonotonicMs) ||
    !Number.isFinite(receivedAtMonotonicMs) ||
    !Number.isFinite(serverTimeMs) ||
    roundTripMs < 0 ||
    roundTripMs > maxRoundTripMs
  ) {
    return null;
  }

  const estimatedMonotonicAtServerReply = sentAtMonotonicMs + roundTripMs / 2;
  return {
    roundTripMs,
    monotonicToServerOffsetMs: serverTimeMs - estimatedMonotonicAtServerReply,
  };
}

/** The lowest round trip has the least room for asymmetric-delay error. */
export function selectBestSample(
  samples: readonly ClockSample[],
): ClockSample | null {
  let best: ClockSample | null = null;
  for (const sample of samples) {
    if (!best || sample.roundTripMs < best.roundTripMs) {
      best = sample;
    }
  }
  return best;
}

export function estimateServerTimeMs(
  sample: ClockSample,
  nowMonotonicMs: number,
): number {
  return nowMonotonicMs + sample.monotonicToServerOffsetMs;
}
