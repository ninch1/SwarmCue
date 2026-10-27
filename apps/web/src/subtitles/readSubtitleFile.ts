import {
  decodeSubtitleBytes,
  normalizeSubtitle,
  subtitleFormatFromName,
  SUBTITLE_MAX_BYTES,
  type SubtitleResult,
} from "./normalizeSubtitle.js";

/**
 * Read a user-picked subtitle file. The name and size are checked before any
 * bytes are read; the MIME type is ignored because local files often have a
 * missing or wrong one.
 */
export async function readSubtitleFile(file: File): Promise<SubtitleResult> {
  if (subtitleFormatFromName(file.name) === null) {
    return {
      ok: false,
      error: {
        code: "unsupported_type",
        message: "Only .srt and .vtt subtitle files are supported.",
      },
    };
  }
  if (file.size > SUBTITLE_MAX_BYTES) {
    return {
      ok: false,
      error: { code: "too_large", message: "Subtitle files must be 1 MB or smaller." },
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return {
      ok: false,
      error: { code: "unreadable", message: "The browser could not read this file." },
    };
  }

  const decoded = decodeSubtitleBytes(bytes);
  if (!decoded.ok) {
    return decoded;
  }
  return normalizeSubtitle(file.name, decoded.text);
}
