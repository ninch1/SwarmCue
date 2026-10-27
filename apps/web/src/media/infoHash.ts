const INFO_HASH_PATTERN = /[?&]xt=urn:btih:([0-9a-f]{40}|[a-z2-7]{32})(?:&|$)/i;

/**
 * The torrent's info hash from a magnet URI, lowercased so magnets can be
 * compared. It depends only on the file's contents and name, so seeding the
 * same file again yields the same hash.
 */
export function infoHashOf(magnetUri: string): string | null {
  const match = INFO_HASH_PATTERN.exec(magnetUri);
  return match?.[1] ? match[1].toLowerCase() : null;
}

/** True when both magnets name the same torrent. */
export function isSameTorrent(a: string | null, b: string | null): boolean {
  if (a === null || b === null) {
    return false;
  }
  const hashA = infoHashOf(a);
  return hashA !== null && hashA === infoHashOf(b);
}
