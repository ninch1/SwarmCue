// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedSubtitleText } from "../room/roomSession.js";
import { useSubtitles, type RoomSubtitle, type UseSubtitlesOptions } from "./useSubtitles.js";

const MAGNET = "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056";
const idA = "AAAAAAAAAAAAAAAAAAAAAA";
const idB = "BBBBBBBBBBBBBBBBBBBBBB";

function roomSubtitle(id: string, sharedBy = "p2", withText = true): RoomSubtitle {
  const text: SharedSubtitleText = { id, vtt: `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${id}\n` };
  return {
    metadata: { id, name: `${id.slice(0, 1)}.srt`, sizeBytes: 50, sharedBy },
    text: withText ? text : null,
    sharedByName: sharedBy === "p2" ? "Nini" : "Ada",
  };
}

const srtFile = (name = "mine.srt") =>
  new File(["1\n00:00:01,000 --> 00:00:02,000\nMine\n"], name);

describe("useSubtitles", () => {
  let created: Map<string, Blob>;
  let revoked: string[];

  beforeEach(() => {
    created = new Map();
    revoked = [];
    // jsdom does not implement object URLs.
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        const url = `blob:${created.size + 1}`;
        created.set(url, blob);
        return url;
      },
      revokeObjectURL: (url: string) => {
        revoked.push(url);
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  function setup(initial: Partial<UseSubtitlesOptions> = {}) {
    const setSubtitle = vi.fn<UseSubtitlesOptions["setSubtitle"]>(() => null);
    const removeSubtitle = vi.fn<UseSubtitlesOptions["removeSubtitle"]>(() => null);
    let options: UseSubtitlesOptions = {
      mediaKey: "torrent:abc",
      room: null,
      shareTarget: { mediaMagnetUri: MAGNET, key: `ROOM|${MAGNET}` },
      shareStatus: { status: "idle" },
      selfId: "p1",
      setSubtitle,
      removeSubtitle,
      ...initial,
    };
    const view = renderHook((props: UseSubtitlesOptions) => useSubtitles(props), {
      initialProps: options,
    });
    return {
      view,
      setSubtitle,
      removeSubtitle,
      current: () => view.result.current,
      update: (changes: Partial<UseSubtitlesOptions>) => {
        options = { ...options, ...changes };
        view.rerender(options);
      },
      async addPersonal(name = "mine.srt") {
        act(() => view.result.current.control.onPersonalFile(srtFile(name)));
        await waitFor(() => expect(view.result.current.control.personal?.fileName).toBe(name));
      },
    };
  }

  it("shows a room subtitle that arrives for someone without one", () => {
    const harness = setup();

    harness.update({ room: roomSubtitle(idA) });

    expect(harness.current().control.active).toBe("shared");
    expect(harness.current().track).toEqual({
      id: `shared:${idA}`,
      url: "blob:1",
      label: "A.srt",
      enabled: true,
    });
  });

  it("waits for the text before showing the room subtitle", () => {
    const harness = setup();

    harness.update({ room: roomSubtitle(idA, "p2", false) });
    expect(harness.current().control.room).toEqual({ name: "A.srt", sharedByName: "Nini", ready: false });
    expect(harness.current().track).toBeNull();

    harness.update({ room: roomSubtitle(idA) });
    expect(harness.current().track?.id).toBe(`shared:${idA}`);
  });

  it("switches between personal and room subtitles without revoking either", async () => {
    const harness = setup({ room: roomSubtitle(idA) });
    await harness.addPersonal();
    const personalTrack = harness.current().track;
    expect(personalTrack).toMatchObject({ id: "personal:1", enabled: true });

    act(() => harness.current().control.onSelect("shared"));
    expect(harness.current().track).toMatchObject({ id: `shared:${idA}`, enabled: true });
    act(() => harness.current().control.onSelect("personal"));
    expect(harness.current().track).toEqual(personalTrack);

    expect(revoked).toEqual([]);
  });

  it("keeps a personal subtitle in use when the room subtitle is replaced, with a notice", async () => {
    const harness = setup({ room: roomSubtitle(idA) });
    await harness.addPersonal();
    const sharedUrlA = [...created.keys()][0];

    harness.update({ room: roomSubtitle(idB) });

    expect(harness.current().control.active).toBe("personal");
    expect(harness.current().track?.id).toBe("personal:1");
    expect(harness.current().control.notice).toBe("Nini shared B.srt.");
    expect(revoked).toEqual([sharedUrlA]);
  });

  it("does not announce your own subtitle", async () => {
    const harness = setup();
    await harness.addPersonal();

    harness.update({ room: roomSubtitle(idA, "p1") });

    expect(harness.current().control.notice).toBeNull();
  });

  it("turns off a removed room subtitle without touching the personal one", async () => {
    const harness = setup({ room: roomSubtitle(idA) });
    await harness.addPersonal();
    act(() => harness.current().control.onSelect("shared"));

    harness.update({ room: null });

    expect(harness.current().control.active).toBe("off");
    expect(harness.current().control.personal?.fileName).toBe("mine.srt");
    expect(revoked).toEqual(["blob:1"]);
  });

  it("keeps the shown track attached but hidden while off, for the captions menu", () => {
    const harness = setup({ room: roomSubtitle(idA) });

    act(() => harness.current().control.onSelect("off"));
    expect(harness.current().track).toMatchObject({ id: `shared:${idA}`, enabled: false });

    act(() => harness.current().onTrackEnabledChange(true));
    expect(harness.current().control.active).toBe("shared");
    act(() => harness.current().onTrackEnabledChange(false));
    expect(harness.current().control.active).toBe("off");
  });

  it("stays off for someone who turned subtitles off when a new room subtitle arrives", () => {
    const harness = setup({ room: roomSubtitle(idA) });
    act(() => harness.current().control.onSelect("off"));

    harness.update({ room: roomSubtitle(idB) });

    expect(harness.current().control.active).toBe("off");
  });

  it("resets everything and revokes the personal URL when the media changes", async () => {
    const harness = setup();
    await harness.addPersonal();
    const personalUrl = harness.current().track?.url;

    harness.update({ mediaKey: "torrent:def", room: null });

    expect(harness.current().control).toMatchObject({ active: "off", personal: null, room: null });
    expect(harness.current().track).toBeNull();
    expect(revoked).toContain(personalUrl);
  });

  it("shares a file as normalized WebVTT and shows it to the sharer", async () => {
    const harness = setup();
    await harness.addPersonal();

    act(() => harness.current().control.onShareFile(srtFile("room.srt")));
    await waitFor(() => expect(harness.setSubtitle).toHaveBeenCalled());

    expect(harness.setSubtitle).toHaveBeenCalledWith({
      name: "room.srt",
      content: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nMine\n",
      mediaMagnetUri: MAGNET,
    });
    await waitFor(() => expect(harness.current().control.active).toBe("shared"));
  });

  it("reports a share that cannot be sent, and the room's rejection", async () => {
    const harness = setup();
    harness.setSubtitle.mockReturnValue("Reconnecting to the room…");

    act(() => harness.current().control.onShareFile(srtFile()));
    await waitFor(() =>
      expect(harness.current().control.shareError).toBe("Reconnecting to the room…"),
    );

    harness.update({ shareStatus: { status: "failed", message: "x" } });
    expect(harness.current().control.shareError).toBe("Reconnecting to the room…");
    act(() => harness.current().control.onShareFile(srtFile()));
    harness.setSubtitle.mockReturnValue(null);
    await waitFor(() => expect(harness.current().control.shareError).toBe("x"));
  });

  it("removes the room subtitle it shows for everyone", () => {
    const harness = setup({ room: roomSubtitle(idA) });

    act(() => harness.current().control.onRoomRemove());

    expect(harness.removeSubtitle).toHaveBeenCalledWith(idA);
  });

  it("cannot share without a target", () => {
    const harness = setup({ shareTarget: null });

    expect(harness.current().control.canShare).toBe(false);
  });
});
