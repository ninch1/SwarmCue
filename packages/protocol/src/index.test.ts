import { describe, expect, it } from "vitest";
import { HealthMessageSchema, ProtocolVersion } from "./index.js";

describe("HealthMessageSchema", () => {
  it("accepts a valid health message", () => {
    const result = HealthMessageSchema.safeParse({
      type: "health",
      protocolVersion: ProtocolVersion,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid message", () => {
    const result = HealthMessageSchema.safeParse({ type: "health" });
    expect(result.success).toBe(false);
  });
});
