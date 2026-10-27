import { describe, expect, it } from "vitest";
import {
  decodeSubtitleBytes,
  normalizeSubtitle,
  subtitleFormatFromName,
  type SubtitleResult,
} from "./normalizeSubtitle.js";

function vttOf(result: SubtitleResult): string {
  if (!result.ok) {
    throw new Error(`Expected success, got ${result.error.code}`);
  }
  return result.subtitle.vtt;
}

function errorCodeOf(result: SubtitleResult): string {
  if (result.ok) {
    throw new Error("Expected an error");
  }
  return result.error.code;
}

const basicSrt = [
  "1",
  "00:00:01,000 --> 00:00:02,500",
  "Hello there.",
  "",
  "2",
  "00:00:03,000 --> 00:00:04,000",
  "General Kenobi!",
  "",
].join("\n");

const basicVtt = [
  "WEBVTT",
  "",
  "00:00:01.000 --> 00:00:02.500",
  "Hello there.",
  "",
  "00:00:03.000 --> 00:00:04.000",
  "General Kenobi!",
  "",
].join("\n");

describe("subtitleFormatFromName", () => {
  it.each([
    ["movie.srt", "srt"],
    ["Movie.EN.SRT", "srt"],
    ["movie.vtt", "vtt"],
    ["movie.ass", null],
    ["movie.srt.txt", null],
    ["srt", null],
  ])("%s is %s", (name, format) => {
    expect(subtitleFormatFromName(name)).toBe(format);
  });
});

describe("decodeSubtitleBytes", () => {
  it("decodes UTF-8, including non-Latin text", () => {
    const bytes = new TextEncoder().encode("გამარჯობა – привет");

    expect(decodeSubtitleBytes(bytes)).toEqual({ ok: true, text: "გამარჯობა – привет" });
  });

  it("rejects bytes that are not valid UTF-8 (e.g. Windows-1251)", () => {
    const result = decodeSubtitleBytes(new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]));

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("not_utf8");
  });
});

describe("normalizeSubtitle: SRT", () => {
  it("converts a valid SRT file to WebVTT", () => {
    const result = normalizeSubtitle("movie.srt", basicSrt);

    expect(result).toEqual({
      ok: true,
      subtitle: { vtt: basicVtt, sourceFormat: "srt", cueCount: 2, skippedBlocks: 0 },
    });
  });

  it.each([
    ["CRLF", basicSrt.replace(/\n/g, "\r\n")],
    ["CR", basicSrt.replace(/\n/g, "\r")],
    ["a UTF-8 BOM", `\uFEFF${basicSrt}`],
    ["a BOM and CRLF", `\uFEFF${basicSrt.replace(/\n/g, "\r\n")}`],
    ["no trailing newline", basicSrt.trimEnd()],
  ])("handles %s", (_label, input) => {
    expect(vttOf(normalizeSubtitle("movie.srt", input))).toBe(basicVtt);
  });

  it("does not require cue numbers", () => {
    const input = basicSrt.replace(/^\d+\n/gm, "");

    expect(vttOf(normalizeSubtitle("movie.srt", input))).toBe(basicVtt);
  });

  it("keeps multiline text and tolerates extra blank lines between cues", () => {
    const input = [
      "1",
      "00:00:01,000 --> 00:00:02,000",
      "First line",
      "Second line",
      "",
      "   ",
      "",
      "2",
      "00:00:03,000 --> 00:00:04,000",
      "Next",
    ].join("\n");

    expect(vttOf(normalizeSubtitle("movie.srt", input))).toBe(
      [
        "WEBVTT",
        "",
        "00:00:01.000 --> 00:00:02.000",
        "First line",
        "Second line",
        "",
        "00:00:03.000 --> 00:00:04.000",
        "Next",
        "",
      ].join("\n"),
    );
  });

  it("supports hours above zero and above 99", () => {
    const input = [
      "1",
      "01:59:59,999 --> 02:00:01,000",
      "Late",
      "",
      "2",
      "100:00:00,000 --> 100:00:01,000",
      "Very late",
    ].join("\n");

    const vtt = vttOf(normalizeSubtitle("movie.srt", input));

    expect(vtt).toContain("01:59:59.999 --> 02:00:01.000");
    expect(vtt).toContain("100:00:00.000 --> 100:00:01.000");
  });

  it("accepts dot separators, short fractions, tight arrows and coordinates", () => {
    const input = "1\n0:0:1.5-->0:00:02,25  X1:100 X2:200 Y1:10 Y2:20\nText\n";

    expect(vttOf(normalizeSubtitle("movie.srt", input))).toBe(
      "WEBVTT\n\n00:00:01.500 --> 00:00:02.250\nText\n",
    );
  });

  it("keeps i/b/u tags, drops font and ASS overrides, and escapes the rest", () => {
    const input = [
      "1",
      "00:00:01,000 --> 00:00:02,000",
      '{\\an8}<I>Top</I> <font color="#ff0000">red</font>',
      "a < b && c > d --> e &amp; f",
    ].join("\n");

    expect(vttOf(normalizeSubtitle("movie.srt", input))).toBe(
      [
        "WEBVTT",
        "",
        "00:00:01.000 --> 00:00:02.000",
        "<i>Top</i> red",
        "a &lt; b &amp;&amp; c &gt; d --&gt; e &amp; f",
        "",
      ].join("\n"),
    );
  });

  it("splits cues that are missing the blank line between them", () => {
    const input = [
      "1",
      "00:00:01,000 --> 00:00:02,500",
      "Hello there.",
      "2",
      "00:00:03,000 --> 00:00:04,000",
      "General Kenobi!",
    ].join("\n");

    expect(vttOf(normalizeSubtitle("movie.srt", input))).toBe(basicVtt);
  });

  it("skips and counts malformed blocks", () => {
    const input = [
      basicSrt,
      "3",
      "00:00:05,000 --> 00:00:04,000",
      "Ends before it starts",
      "",
      "4",
      "00:61:00,000 --> 00:62:00,000",
      "Impossible minutes",
      "",
      "just some stray text",
      "",
    ].join("\n");

    const result = normalizeSubtitle("movie.srt", input);

    expect(result).toEqual({
      ok: true,
      subtitle: { vtt: basicVtt, sourceFormat: "srt", cueCount: 2, skippedBlocks: 3 },
    });
  });

  it("drops cues whose text is empty after cleaning", () => {
    const input = `${basicSrt}\n3\n00:00:05,000 --> 00:00:06,000\n{\\an8}\n`;

    expect(vttOf(normalizeSubtitle("movie.srt", input))).toBe(basicVtt);
  });

  it("rejects a file without any readable cue", () => {
    expect(errorCodeOf(normalizeSubtitle("movie.srt", "Hello\nWorld\n"))).toBe("no_cues");
  });

  it("treats a .srt file that is really WebVTT as WebVTT", () => {
    const result = normalizeSubtitle("movie.srt", basicVtt);

    expect(result.ok && result.subtitle.sourceFormat).toBe("vtt");
    expect(vttOf(result)).toBe(basicVtt);
  });
});

describe("normalizeSubtitle: WebVTT", () => {
  it("keeps valid WebVTT as written", () => {
    const input = [
      "WEBVTT - Example",
      "",
      "STYLE",
      "::cue { color: yellow }",
      "",
      "NOTE a comment",
      "",
      "intro",
      "00:01.000 --> 00:02.000 line:0 align:start",
      "<v Narrator>Hi &amp; welcome</v>",
      "",
    ].join("\n");

    const result = normalizeSubtitle("movie.vtt", input);

    expect(result).toEqual({
      ok: true,
      subtitle: { vtt: input, sourceFormat: "vtt", cueCount: 1, skippedBlocks: 0 },
    });
  });

  it("only removes the BOM, normalizes line endings and adds a trailing newline", () => {
    const input = `\uFEFF${basicVtt.trimEnd().replace(/\n/g, "\r\n")}`;

    expect(vttOf(normalizeSubtitle("movie.vtt", input))).toBe(basicVtt);
  });

  it("rejects a .vtt file without a WEBVTT header", () => {
    expect(errorCodeOf(normalizeSubtitle("movie.vtt", basicSrt))).toBe("invalid_vtt");
    expect(errorCodeOf(normalizeSubtitle("movie.vtt", "WEBVTTX\n\n"))).toBe("invalid_vtt");
  });

  it("rejects WebVTT without cues", () => {
    expect(errorCodeOf(normalizeSubtitle("movie.vtt", "WEBVTT\n\nNOTE nothing here\n"))).toBe(
      "no_cues",
    );
  });
});

describe("normalizeSubtitle: rejected input", () => {
  it.each([
    ["an unsupported extension", "movie.ass", basicSrt, "unsupported_type"],
    ["a .txt file", "movie.txt", basicSrt, "unsupported_type"],
    ["an empty file", "movie.srt", "", "empty"],
    ["only whitespace and a BOM", "movie.srt", "\uFEFF \r\n\t\n", "empty"],
    ["binary content", "movie.srt", `${basicSrt}\u0000\u0001`, "unsupported_type"],
  ])("rejects %s", (_label, name, text, code) => {
    expect(errorCodeOf(normalizeSubtitle(name, text))).toBe(code);
  });
});
