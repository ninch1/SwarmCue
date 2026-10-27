/** Local subtitle files larger than this are rejected before being read. */
export const SUBTITLE_MAX_BYTES = 1024 * 1024;

export type SubtitleSourceFormat = "srt" | "vtt";

export type NormalizedSubtitle = {
  /** Valid WebVTT: no BOM, LF line endings, trailing newline. */
  vtt: string;
  sourceFormat: SubtitleSourceFormat;
  cueCount: number;
  /** SRT blocks dropped because they could not be read. */
  skippedBlocks: number;
};

export type SubtitleErrorCode =
  | "unsupported_type"
  | "too_large"
  | "unreadable"
  | "empty"
  | "not_utf8"
  | "invalid_vtt"
  | "no_cues";

export type SubtitleError = { code: SubtitleErrorCode; message: string };

export type SubtitleResult =
  | { ok: true; subtitle: NormalizedSubtitle }
  | { ok: false; error: SubtitleError };

export type DecodeResult = { ok: true; text: string } | { ok: false; error: SubtitleError };

const VTT_HEADER = /^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/;
const VTT_TIMING_LINE =
  /^(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}[ \t]+-->[ \t]+(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}/gm;
/** Anything shaped like an SRT timing line, valid or not. */
const SRT_TIMING_SHAPE = /^\d+:\d+:\d+[,.]\d+\s*-->/;
const SRT_TIMING =
  /^(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})(?:\s.*)?$/;
const CUE_NUMBER = /^\d+$/;
/** The only SRT tags WebVTT also understands. */
const KEPT_TAG = /<\/?[ibu]>/gi;
const KNOWN_ENTITY = /^&(?:amp|lt|gt|nbsp|lrm|rlm);/;

function failure(code: SubtitleErrorCode, message: string): { ok: false; error: SubtitleError } {
  return { ok: false, error: { code, message } };
}

/** The subtitle format implied by a file name, or null if unsupported. */
export function subtitleFormatFromName(fileName: string): SubtitleSourceFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".srt")) {
    return "srt";
  }
  if (lower.endsWith(".vtt")) {
    return "vtt";
  }
  return null;
}

/** Decode file bytes as UTF-8. Other encodings cannot be detected reliably, so they are rejected. */
export function decodeSubtitleBytes(bytes: Uint8Array): DecodeResult {
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return failure(
      "not_utf8",
      "This subtitle file isn't UTF-8. Re-save it as UTF-8 and try again.",
    );
  }
}

/**
 * Turn .srt or .vtt text into WebVTT for a <track> element. WebVTT input is
 * kept as written (only the BOM and line endings change); SRT is converted.
 * Text starting with a WEBVTT header is treated as WebVTT whatever its name.
 */
export function normalizeSubtitle(fileName: string, text: string): SubtitleResult {
  const format = subtitleFormatFromName(fileName);
  if (format === null) {
    return failure("unsupported_type", "Only .srt and .vtt subtitle files are supported.");
  }

  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (normalized.trim() === "") {
    return failure("empty", "This subtitle file is empty.");
  }
  if (normalized.includes("\u0000")) {
    return failure("unsupported_type", "This file doesn't contain subtitle text.");
  }

  if (VTT_HEADER.test(normalized)) {
    return checkVtt(normalized);
  }
  if (format === "vtt") {
    return failure(
      "invalid_vtt",
      "This file is missing the WEBVTT header, so it isn't a valid WebVTT file.",
    );
  }
  return convertSrt(normalized);
}

function checkVtt(vtt: string): SubtitleResult {
  const cueCount = vtt.match(VTT_TIMING_LINE)?.length ?? 0;
  if (cueCount === 0) {
    return failure("no_cues", "No subtitles could be read from this file.");
  }
  return {
    ok: true,
    subtitle: {
      vtt: vtt.endsWith("\n") ? vtt : `${vtt}\n`,
      sourceFormat: "vtt",
      cueCount,
      skippedBlocks: 0,
    },
  };
}

/** Lines grouped into blocks separated by blank or whitespace-only lines. */
function splitBlocks(text: string): string[][] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      if (block.length > 0) {
        blocks.push(block);
        block = [];
      }
    } else {
      block.push(line);
    }
  }
  if (block.length > 0) {
    blocks.push(block);
  }
  return blocks;
}

type SrtCue = { timing: string; lines: string[] };

function convertSrt(text: string): SubtitleResult {
  const cues: string[] = [];
  let skippedBlocks = 0;

  const pushCue = (cue: SrtCue) => {
    const body = cue.lines.map(toCueText).filter((line) => line !== "");
    if (body.length > 0) {
      cues.push(`${cue.timing}\n${body.join("\n")}`);
    }
  };

  for (const block of splitBlocks(text)) {
    let cue: SrtCue | null = null;
    let sawTiming = false;

    for (const line of block) {
      const trimmed = line.trim();
      if (!SRT_TIMING_SHAPE.test(trimmed)) {
        // Lines before the first timing line (the cue number) are dropped.
        cue?.lines.push(line);
        continue;
      }
      if (cue) {
        // A timing line inside a block means a missing blank line: the number
        // just above it belongs to this cue, not to the previous cue's text.
        if (CUE_NUMBER.test(cue.lines.at(-1)?.trim() ?? "")) {
          cue.lines.pop();
        }
        pushCue(cue);
      }
      sawTiming = true;
      const timing = toVttTiming(trimmed);
      if (timing === null) {
        skippedBlocks += 1;
      }
      cue = timing === null ? null : { timing, lines: [] };
    }
    if (cue) {
      pushCue(cue);
    }
    if (!sawTiming) {
      skippedBlocks += 1;
    }
  }

  if (cues.length === 0) {
    return failure("no_cues", "No subtitles could be read from this file.");
  }
  return {
    ok: true,
    subtitle: {
      vtt: `WEBVTT\n\n${cues.join("\n\n")}\n`,
      sourceFormat: "srt",
      cueCount: cues.length,
      skippedBlocks,
    },
  };
}

/** `00:01:02,5 --> 00:01:04,000 X1:…` to `00:01:02.500 --> 00:01:04.000`, or null if invalid. */
function toVttTiming(line: string): string | null {
  const match = SRT_TIMING.exec(line);
  if (!match) {
    return null;
  }
  const [, h1 = "", m1 = "", s1 = "", f1 = "", h2 = "", m2 = "", s2 = "", f2 = ""] = match;
  const start = toMilliseconds(h1, m1, s1, f1);
  const end = toMilliseconds(h2, m2, s2, f2);
  if (start === null || end === null || end <= start) {
    return null;
  }
  return `${formatTimestamp(start)} --> ${formatTimestamp(end)}`;
}

function toMilliseconds(
  hours: string,
  minutes: string,
  seconds: string,
  fraction: string,
): number | null {
  const m = Number(minutes);
  const s = Number(seconds);
  if (m >= 60 || s >= 60) {
    return null;
  }
  return ((Number(hours) * 60 + m) * 60 + s) * 1000 + Number(fraction.padEnd(3, "0"));
}

function formatTimestamp(totalMs: number): string {
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(
    2,
    "0",
  )}.${String(ms).padStart(3, "0")}`;
}

/**
 * One SRT text line as WebVTT cue text: keep <i>, <b>, <u>; drop <font> and
 * ASS-style `{\an8}` overrides; escape everything else, which also stops a
 * literal "-->" from ending the cue.
 */
function toCueText(line: string): string {
  const stripped = line.replace(/\{\\[^}]*\}/g, "").replace(/<\/?font\b[^>]*>/gi, "");
  let result = "";
  let last = 0;
  for (const match of stripped.matchAll(KEPT_TAG)) {
    result += escapeCueText(stripped.slice(last, match.index)) + match[0].toLowerCase();
    last = match.index + match[0].length;
  }
  result += escapeCueText(stripped.slice(last));
  return result.trimEnd();
}

function escapeCueText(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "&") {
      result += KNOWN_ENTITY.test(text.slice(i)) ? "&" : "&amp;";
    } else if (char === "<") {
      result += "&lt;";
    } else if (char === ">") {
      result += "&gt;";
    } else {
      result += char;
    }
  }
  return result;
}
