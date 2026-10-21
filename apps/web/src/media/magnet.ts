import { MEDIA_NAME_MAX_LENGTH } from "@swarmcue/protocol";

export type MagnetMetadata = {
  name: string | null;
  sizeBytes: number | null;
};

/** Clean a file or torrent name so it fits the shared-media schema; null if nothing is left. */
export function toMediaName(raw: string): string | null {
  return (
    raw
      .replace(/\p{Cc}/gu, "")
      .trim()
      .slice(0, MEDIA_NAME_MAX_LENGTH)
      .trim() || null
  );
}

/**
 * Best-effort name (`dn=`) and size (`xl=`) from a magnet link. Either may be
 * missing; values are cleaned so they fit the shared-media schema.
 */
export function magnetMetadata(magnetUri: string): MagnetMetadata {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(magnetUri.trim().replace(/^magnet:\?/i, ""));
  } catch {
    return { name: null, sizeBytes: null };
  }

  const rawName = params.get("dn");
  const name = rawName === null ? null : toMediaName(rawName);

  const rawSize = params.get("xl");
  const size = rawSize !== null && /^\d+$/.test(rawSize) ? Number(rawSize) : NaN;
  const sizeBytes = Number.isSafeInteger(size) ? size : null;

  return { name, sizeBytes };
}

/**
 * Lightweight magnet URI shape check.
 * Full torrent parsing arrives with WebTorrent; this only guards the UI.
 */
export function isMagnetUri(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("magnet:?")) {
    return false;
  }

  try {
    const params = new URLSearchParams(trimmed.slice("magnet:?".length));
    const xt = params.get("xt");
    return xt !== null && /^urn:btih:[a-z0-9]+$/i.test(xt);
  } catch {
    return false;
  }
}
