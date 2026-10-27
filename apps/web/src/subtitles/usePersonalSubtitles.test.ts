// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePersonalSubtitles } from "./usePersonalSubtitles.js";

const srtFile = () =>
  new File(["1\n00:00:01,000 --> 00:00:02,000\nHello\n"], "movie.srt", { type: "" });

describe("usePersonalSubtitles", () => {
  let created: string[];
  let revoked: string[];
  let blobs: Blob[];

  beforeEach(() => {
    created = [];
    revoked = [];
    blobs = [];
    // jsdom does not implement object URLs.
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        const url = `blob:test-${created.length + 1}`;
        created.push(url);
        return url;
      },
      revokeObjectURL: (url: string) => {
        revoked.push(url);
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function renderWithSubtitle(mediaKey: string | null = "torrent:abc") {
    const view = renderHook(({ key }) => usePersonalSubtitles(key), {
      initialProps: { key: mediaKey },
    });
    act(() => view.result.current.select(srtFile()));
    await waitFor(() => expect(view.result.current.subtitle).not.toBeNull());
    return view;
  }

  it("loads a picked file as a WebVTT object URL", async () => {
    const { result } = await renderWithSubtitle();

    expect(result.current.subtitle).toMatchObject({
      fileName: "movie.srt",
      url: "blob:test-1",
      cueCount: 1,
    });
    expect(blobs[0]?.type).toBe("text/vtt");
    expect(await blobs[0]?.text()).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n");
  });

  it("clears the subtitle and revokes its URL when the media changes", async () => {
    const view = await renderWithSubtitle("torrent:abc");

    view.rerender({ key: "torrent:def" });

    expect(view.result.current.subtitle).toBeNull();
    expect(revoked).toEqual(["blob:test-1"]);
  });

  it("clears the subtitle when leaving the room (no media)", async () => {
    const view = await renderWithSubtitle("file:blob:video");

    view.rerender({ key: null });

    expect(view.result.current.subtitle).toBeNull();
    expect(revoked).toEqual(["blob:test-1"]);
  });

  it("keeps the subtitle while the media stays the same", async () => {
    const view = await renderWithSubtitle("torrent:abc");

    view.rerender({ key: "torrent:abc" });

    expect(view.result.current.subtitle?.url).toBe("blob:test-1");
    expect(revoked).toEqual([]);
  });

  it("revokes the URL on unmount", async () => {
    const view = await renderWithSubtitle();

    view.unmount();

    expect(revoked).toEqual(["blob:test-1"]);
  });

  it("shows a validation error and keeps the previous subtitle", async () => {
    const { result } = await renderWithSubtitle();

    act(() => result.current.select(new File(["hello"], "notes.txt")));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error).toEqual({
      fileName: "notes.txt",
      message: "Only .srt and .vtt subtitle files are supported.",
    });
    expect(result.current.subtitle?.url).toBe("blob:test-1");
  });
});
