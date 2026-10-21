/** Accept codes typed in any case, with spaces or a hyphen (e.g. "k7qm-3xpd"). */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

/** Display form with a hyphen in the middle, e.g. "K7QM-3XPD". */
export function formatRoomCode(roomId: string): string {
  const middle = Math.ceil(roomId.length / 2);
  return `${roomId.slice(0, middle)}-${roomId.slice(middle)}`;
}
