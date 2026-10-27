import { describe, expect, it } from "vitest";
import type { SubtitleResult } from "./normalizeSubtitle.js";
import {
  createPersonalSubtitles,
  type PersonalSubtitleState,
} from "./personalSubtitles.js";

const okResult = (vtt: string): SubtitleResult => ({
  ok: true,
  subtitle: { vtt, sourceFormat: "srt", cueCount: 3, skippedBlocks: 1 },
});

const badResult: SubtitleResult = {
  ok: false,
  error: { code: "no_cues", message: "No subtitles could be read from this file." },
};

type PendingRead = { file: File; resolve: (result: SubtitleResult) => void };

function setup() {
  const pending: PendingRead[] = [];
  const created: string[] = [];
  const revoked: string[] = [];
  const states: PersonalSubtitleState[] = [];
  let urlCount = 0;

  const subtitles = createPersonalSubtitles({
    readFile: (file) =>
      new Promise((resolve) => {
        pending.push({ file, resolve });
      }),
    createObjectUrl: (vtt) => {
      const url = `blob:${++urlCount}:${vtt}`;
      created.push(url);
      return url;
    },
    revokeObjectUrl: (url) => {
      revoked.push(url);
    },
    onStateChange: (state) => {
      states.push(state);
    },
  });

  /** Pick a file and finish reading it with `result`. */
  async function pick(name: string, result: SubtitleResult) {
    const done = subtitles.select(new File(["x"], name));
    pending.at(-1)!.resolve(result);
    await done;
  }

  const live = () => created.filter((url) => !revoked.includes(url));

  return { subtitles, pending, created, revoked, states, pick, live };
}

describe("createPersonalSubtitles", () => {
  it("loads a file as a subtitle with an object URL", async () => {
    const { subtitles, pending, states } = setup();

    const done = subtitles.select(new File(["x"], "movie.srt"));
    expect(subtitles.getState()).toEqual({ subtitle: null, loading: true, error: null });
    pending[0]!.resolve(okResult("WEBVTT A"));
    await done;

    expect(subtitles.getState()).toEqual({
      subtitle: {
        id: 1,
        fileName: "movie.srt",
        url: "blob:1:WEBVTT A",
        cueCount: 3,
        skippedBlocks: 1,
      },
      loading: false,
      error: null,
    });
    expect(states.at(-1)).toBe(subtitles.getState());
  });

  it("replaces a subtitle and revokes the old URL", async () => {
    const { subtitles, pick, created, revoked } = setup();
    await pick("one.srt", okResult("A"));

    await pick("two.vtt", okResult("B"));

    expect(subtitles.getState().subtitle).toMatchObject({
      id: 2,
      fileName: "two.vtt",
      url: created[1],
    });
    expect(revoked).toEqual([created[0]]);
  });

  it("treats picking the same file again as a replacement", async () => {
    const { subtitles, pick, created, revoked } = setup();
    await pick("movie.srt", okResult("A"));

    await pick("movie.srt", okResult("A"));

    expect(subtitles.getState().subtitle).toMatchObject({ id: 2, url: created[1] });
    expect(revoked).toEqual([created[0]]);
  });

  it("removes the subtitle and revokes its URL", async () => {
    const { subtitles, pick, created, revoked } = setup();
    await pick("movie.srt", okResult("A"));

    subtitles.remove();

    expect(subtitles.getState()).toEqual({ subtitle: null, loading: false, error: null });
    expect(revoked).toEqual([created[0]]);
  });

  it("keeps the previous subtitle when a new file fails to parse", async () => {
    const { subtitles, pick, created, revoked } = setup();
    await pick("good.srt", okResult("A"));

    await pick("bad.srt", badResult);

    expect(subtitles.getState()).toEqual({
      subtitle: expect.objectContaining({ id: 1, url: created[0] }),
      loading: false,
      error: { fileName: "bad.srt", message: badResult.ok ? "" : badResult.error.message },
    });
    expect(revoked).toEqual([]);

    await pick("better.srt", okResult("B"));
    expect(subtitles.getState().error).toBeNull();
  });

  it("reports a read that throws", async () => {
    const { subtitles, pending } = setup();

    const done = subtitles.select(new File(["x"], "movie.srt"));
    pending[0]!.resolve(Promise.reject(new Error("boom")) as never);
    await done;

    expect(subtitles.getState().error).toEqual({
      fileName: "movie.srt",
      message: "The browser could not read this file.",
    });
  });

  it("resets on a media change, clearing the subtitle and the error", async () => {
    const { subtitles, pick, created, revoked } = setup();
    await pick("good.srt", okResult("A"));
    await pick("bad.srt", badResult);

    subtitles.reset();

    expect(subtitles.getState()).toEqual({ subtitle: null, loading: false, error: null });
    expect(revoked).toEqual([created[0]]);
  });

  it("ignores a read that finishes after a reset", async () => {
    const { subtitles, pending, created } = setup();

    const done = subtitles.select(new File(["x"], "old-media.srt"));
    subtitles.reset();
    pending[0]!.resolve(okResult("A"));
    await done;

    expect(subtitles.getState()).toEqual({ subtitle: null, loading: false, error: null });
    expect(created).toEqual([]);
  });

  it("ignores an older read that finishes after a newer pick", async () => {
    const { subtitles, pending, created } = setup();

    const first = subtitles.select(new File(["x"], "slow.srt"));
    const second = subtitles.select(new File(["x"], "fast.srt"));
    pending[1]!.resolve(okResult("FAST"));
    await second;
    pending[0]!.resolve(okResult("SLOW"));
    await first;

    expect(subtitles.getState().subtitle?.fileName).toBe("fast.srt");
    expect(created).toEqual(["blob:1:FAST"]);
  });

  it("revokes the URL on dispose and ignores later reads", async () => {
    const { subtitles, pick, pending, created, revoked, live } = setup();
    await pick("movie.srt", okResult("A"));
    const late = subtitles.select(new File(["x"], "late.srt"));

    subtitles.dispose();
    pending.at(-1)!.resolve(okResult("B"));
    await late;

    expect(revoked).toEqual([created[0]]);
    expect(created).toHaveLength(1);
    expect(live()).toEqual([]);
  });

  it("leaves no live object URL after any sequence of actions and dispose", async () => {
    const { subtitles, pick, live } = setup();
    await pick("a.srt", okResult("A"));
    await pick("b.srt", okResult("B"));
    await pick("bad.srt", badResult);
    subtitles.remove();
    await pick("c.srt", okResult("C"));
    subtitles.reset();
    await pick("d.srt", okResult("D"));

    expect(live()).toHaveLength(1);
    subtitles.dispose();
    expect(live()).toEqual([]);
  });

  it("does not emit when there is nothing to clear", () => {
    const { subtitles, states } = setup();

    subtitles.reset();
    subtitles.remove();

    expect(states).toEqual([]);
  });
});
