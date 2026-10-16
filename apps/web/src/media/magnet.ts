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
