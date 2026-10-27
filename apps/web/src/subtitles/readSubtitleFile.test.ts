import { describe, expect, it, vi } from "vitest";
import { SUBTITLE_MAX_BYTES } from "./normalizeSubtitle.js";
import { readSubtitleFile } from "./readSubtitleFile.js";

const srt = "1\n00:00:01,000 --> 00:00:02,000\nHello\n";

describe("readSubtitleFile", () => {
  it("reads and converts an SRT file regardless of its MIME type", async () => {
    const file = new File([srt], "movie.srt", { type: "application/octet-stream" });

    const result = await readSubtitleFile(file);

    expect(result).toEqual({
      ok: true,
      subtitle: {
        vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n",
        sourceFormat: "srt",
        cueCount: 1,
        skippedBlocks: 0,
      },
    });
  });

  it("rejects an unsupported extension without reading the file", async () => {
    const file = new File([srt], "movie.ass");
    const read = vi.spyOn(file, "arrayBuffer");

    const result = await readSubtitleFile(file);

    expect(result.ok ? null : result.error.code).toBe("unsupported_type");
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit without reading it", async () => {
    const file = new File([new Uint8Array(SUBTITLE_MAX_BYTES + 1)], "huge.srt");
    const read = vi.spyOn(file, "arrayBuffer");

    const result = await readSubtitleFile(file);

    expect(result.ok ? null : result.error.code).toBe("too_large");
    expect(read).not.toHaveBeenCalled();
  });

  it("accepts a file exactly at the size limit", async () => {
    const padding = " ".repeat(SUBTITLE_MAX_BYTES - srt.length);
    const file = new File([srt + padding], "big.srt");

    const result = await readSubtitleFile(file);

    expect(result.ok).toBe(true);
  });

  it("rejects text that is not UTF-8", async () => {
    const file = new File([new Uint8Array([0x31, 0x0a, 0xcf, 0xf0, 0xe8])], "movie.srt");

    const result = await readSubtitleFile(file);

    expect(result.ok ? null : result.error.code).toBe("not_utf8");
  });

  it("reports a file the browser cannot read", async () => {
    const file = new File([srt], "movie.srt");
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(new DOMException("gone", "NotReadableError"));

    const result = await readSubtitleFile(file);

    expect(result.ok ? null : result.error.code).toBe("unreadable");
  });
});
