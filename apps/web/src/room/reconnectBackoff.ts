/** First retry delay after a dropped connection. */
export const RECONNECT_INITIAL_DELAY_MS = 500;
/** Delays double per attempt up to this cap. */
export const RECONNECT_MAX_DELAY_MS = 5000;
/**
 * Stop retrying after this long. The server's grace period is 30 s, so by
 * then the session has almost certainly expired.
 */
export const RECONNECT_GIVE_UP_AFTER_MS = 60_000;

/**
 * Delay before reconnect attempt `attempt` (0-based): capped exponential
 * backoff with "equal jitter". Half the delay is fixed and half is random,
 * so clients that dropped together do not retry in lockstep.
 */
export function reconnectDelayMs(attempt: number, random: () => number): number {
  const exponential = RECONNECT_INITIAL_DELAY_MS * 2 ** Math.max(0, attempt);
  const capped = Math.min(RECONNECT_MAX_DELAY_MS, exponential);
  return Math.round(capped * (0.5 + random() * 0.5));
}
