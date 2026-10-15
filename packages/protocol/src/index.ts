import { z } from "zod";

/**
 * Shared client-server message contract.
 * Concrete command and event schemas are added in Milestone 1.
 */
export const ProtocolVersion = 1 as const;

export type ProtocolVersion = typeof ProtocolVersion;

/** Placeholder schema so both apps can import this package during setup. */
export const HealthMessageSchema = z.object({
  type: z.literal("health"),
  protocolVersion: z.literal(ProtocolVersion),
});

export type HealthMessage = z.infer<typeof HealthMessageSchema>;
