import { describe, expect, it } from "vitest";
import {
  RECONNECT_INITIAL_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  reconnectDelayMs,
} from "./reconnectBackoff.js";

describe("reconnectDelayMs", () => {
  it("doubles from the initial delay up to the cap at maximum jitter", () => {
    const delays = [0, 1, 2, 3, 4, 5, 10].map((attempt) => reconnectDelayMs(attempt, () => 1));

    expect(delays).toEqual([500, 1000, 2000, 4000, 5000, 5000, 5000]);
  });

  it("keeps the jittered delay between half and all of the base delay", () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(RECONNECT_INITIAL_DELAY_MS / 2);
    expect(reconnectDelayMs(9, () => 0)).toBe(RECONNECT_MAX_DELAY_MS / 2);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const delay = reconnectDelayMs(attempt, Math.random);
      expect(delay).toBeGreaterThanOrEqual(RECONNECT_INITIAL_DELAY_MS / 2);
      expect(delay).toBeLessThanOrEqual(RECONNECT_MAX_DELAY_MS);
    }
  });

  it("treats a negative attempt as the first one", () => {
    expect(reconnectDelayMs(-3, () => 1)).toBe(RECONNECT_INITIAL_DELAY_MS);
  });
});
