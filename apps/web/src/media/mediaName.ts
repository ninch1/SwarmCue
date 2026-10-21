import { MEDIA_NAME_MAX_LENGTH } from "@swarmcue/protocol";

/** Clean a file name so it fits the shared-media schema; null if nothing is left. */
export function toMediaName(raw: string): string | null {
  return (
    raw
      .replace(/\p{Cc}/gu, "")
      .trim()
      .slice(0, MEDIA_NAME_MAX_LENGTH)
      .trim() || null
  );
}
