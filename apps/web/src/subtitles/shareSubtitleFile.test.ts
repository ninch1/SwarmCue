import { SHARED_SUBTITLE_MAX_BYTES } from "@swarmcue/protocol";
import { describe, expect, it } from "vitest";
import type { SubtitleShareRequest } from "../room/roomSession.js";
import type { SubtitleResult } from "./normalizeSubtitle.js";
import { createSubtitleSharer, type SubtitleShareTarget } from "./shareSubtitleFile.js";

const MAGNET = "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056";
const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n";

const ok = (text = vtt): SubtitleResult => ({
  ok: true,
  subtitle: { vtt: text, sourceFormat: "srt", cueCount: 1, skippedBlocks: 0 },
});

function setup() {
  const reads: { resolve: (result: SubtitleResult) => void }[] = [];
  const sent: SubtitleShareRequest[] = [];
  const context: { target: SubtitleShareTarget | null; sendError: string | null } = {
    target: { mediaMagnetUri: MAGNET, key: "room:A|media:1" },
    sendError: null,
  };
  const sharer = createSubtitleSharer({
    readFile: () =>
      new Promise((resolve) => {
        reads.push({ resolve });
      }),
    currentTarget: () => context.target,
    send: (request) => {
      sent.push(request);
      return context.sendError;
    },
  });
  return { sharer, reads, sent, context };
}

describe("createSubtitleSharer", () => {
  it("sends the normalized text for the media it was picked for", async () => {
    const { sharer, reads, sent } = setup();

    const outcome = sharer.share(new File(["x"], "  movie.en.srt"));
    reads[0]!.resolve(ok());

    expect(await outcome).toEqual({ status: "sent" });
    expect(sent).toEqual([{ name: "movie.en.srt", content: vtt, mediaMagnetUri: MAGNET }]);
  });

  it("refuses text over the shared limit without sending it", async () => {
    const { sharer, reads, sent } = setup();

    const outcome = sharer.share(new File(["x"], "big.srt"));
    reads[0]!.resolve(ok(`${vtt}${"x".repeat(SHARED_SUBTITLE_MAX_BYTES)}\n`));

    expect(await outcome).toEqual({
      status: "failed",
      message:
        "Too large to share with the room (512 KB max). You can still add it as your own subtitle.",
    });
    expect(sent).toEqual([]);
  });

  it("reports an unreadable or invalid file", async () => {
    const { sharer, reads } = setup();

    const outcome = sharer.share(new File(["x"], "notes.txt"));
    reads[0]!.resolve({
      ok: false,
      error: { code: "unsupported_type", message: "Only .srt and .vtt subtitle files are supported." },
    });

    expect(await outcome).toEqual({
      status: "failed",
      message: "Only .srt and .vtt subtitle files are supported.",
    });
  });

  it("drops a read that finishes after the media or room changed", async () => {
    const { sharer, reads, sent, context } = setup();

    const outcome = sharer.share(new File(["x"], "movie.srt"));
    context.target = { mediaMagnetUri: MAGNET.replace("c9e1", "0000"), key: "room:A|media:2" };
    reads[0]!.resolve(ok());

    expect(await outcome).toEqual({ status: "stale" });
    expect(sent).toEqual([]);
  });

  it("drops a read that finishes after leaving the room", async () => {
    const { sharer, reads, sent, context } = setup();

    const outcome = sharer.share(new File(["x"], "movie.srt"));
    context.target = null;
    reads[0]!.resolve(ok());

    expect(await outcome).toEqual({ status: "stale" });
    expect(sent).toEqual([]);
  });

  it("drops an older read that finishes after a newer pick, and cancelled reads", async () => {
    const { sharer, reads, sent } = setup();

    const first = sharer.share(new File(["x"], "slow.srt"));
    const second = sharer.share(new File(["x"], "fast.srt"));
    reads[1]!.resolve(ok());
    reads[0]!.resolve(ok());

    expect(await second).toEqual({ status: "sent" });
    expect(await first).toEqual({ status: "stale" });
    expect(sent.map((request) => request.name)).toEqual(["fast.srt"]);

    const third = sharer.share(new File(["x"], "cancelled.srt"));
    sharer.cancel();
    reads[2]!.resolve(ok());
    expect(await third).toEqual({ status: "stale" });
  });

  it("reports when there is nothing to share a subtitle for, or sending fails", async () => {
    const { sharer, reads, context } = setup();

    context.target = null;
    expect(await sharer.share(new File(["x"], "movie.srt"))).toEqual({
      status: "failed",
      message: "There is no video to share a subtitle for.",
    });
    expect(reads).toHaveLength(0);

    context.target = { mediaMagnetUri: MAGNET, key: "k" };
    context.sendError = "Reconnecting to the room…";
    const outcome = sharer.share(new File(["x"], "movie.srt"));
    reads.at(-1)!.resolve(ok());
    expect(await outcome).toEqual({ status: "failed", message: "Reconnecting to the room…" });
  });
});
