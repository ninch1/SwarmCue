// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SharedSubtitleText } from "../room/roomSession.js";
import { useSharedSubtitleUrl } from "./useSharedSubtitleUrl.js";

const idA = "AAAAAAAAAAAAAAAAAAAAAA";
const idB = "BBBBBBBBBBBBBBBBBBBBBB";
const textA: SharedSubtitleText = { id: idA, vtt: "WEBVTT\n\nA\n" };
const textB: SharedSubtitleText = { id: idB, vtt: "WEBVTT\n\nB\n" };

describe("useSharedSubtitleUrl", () => {
  let created: string[];
  let revoked: string[];

  beforeEach(() => {
    created = [];
    revoked = [];
    // jsdom does not implement object URLs.
    Object.assign(URL, {
      createObjectURL: () => {
        const url = `blob:shared-${created.length + 1}`;
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
  });

  function render(initial: SharedSubtitleText | null) {
    return renderHook(({ text }) => useSharedSubtitleUrl(text), { initialProps: { text: initial } });
  }

  const live = () => created.filter((url) => !revoked.includes(url));

  it("creates one URL for the subtitle's text", () => {
    const view = render(textA);

    expect(view.result.current).toEqual({ id: idA, url: "blob:shared-1" });
    expect(created).toHaveLength(1);
  });

  it("keeps the URL when the same subtitle is delivered again", () => {
    const view = render(textA);

    view.rerender({ text: { ...textA } });

    expect(view.result.current?.url).toBe("blob:shared-1");
    expect(created).toHaveLength(1);
    expect(revoked).toEqual([]);
  });

  it("revokes the old URL when the subtitle is replaced, never returning it", () => {
    const view = render(textA);
    const seen: (string | undefined)[] = [];

    view.rerender({ text: textB });
    seen.push(view.result.current?.url);

    expect(revoked).toEqual(["blob:shared-1"]);
    expect(view.result.current).toEqual({ id: idB, url: "blob:shared-2" });
    expect(seen).not.toContain("blob:shared-1");
  });

  it("revokes the URL when the subtitle is removed and on unmount", () => {
    const view = render(textA);

    view.rerender({ text: null });
    expect(view.result.current).toBeNull();
    expect(revoked).toEqual(["blob:shared-1"]);

    view.rerender({ text: textB });
    view.unmount();
    expect(live()).toEqual([]);
  });

  it("returns nothing without a subtitle", () => {
    expect(render(null).result.current).toBeNull();
    expect(created).toEqual([]);
  });
});
