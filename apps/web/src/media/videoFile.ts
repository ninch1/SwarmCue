const PLAYABLE_VIDEO_EXTENSIONS = [
  ".mp4",
  ".m4v",
  ".webm",
  ".mov",
  ".mkv",
  ".ogv",
] as const;

type NamedFile = {
  name: string;
  length: number;
};

export function isPlayableVideoName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return PLAYABLE_VIDEO_EXTENSIONS.some((extension) =>
    lower.endsWith(extension),
  );
}

/**
 * Pick the largest browser-playable video in a torrent, so extras like
 * samples, subtitles, or posters are skipped.
 */
export function pickVideoFile<T extends NamedFile>(
  files: readonly T[],
): T | null {
  let best: T | null = null;
  for (const file of files) {
    if (!isPlayableVideoName(file.name)) {
      continue;
    }
    if (!best || file.length > best.length) {
      best = file;
    }
  }
  return best;
}
