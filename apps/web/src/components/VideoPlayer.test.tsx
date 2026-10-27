// @vitest-environment jsdom
import type { PlaybackState } from "@swarmcue/protocol";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CUE_LINE_PERCENT } from "../subtitles/cuePosition.js";
import { VideoPlayer, type VideoSubtitle } from "./VideoPlayer.js";

const paused: PlaybackState = {
  status: "paused",
  positionSeconds: 12,
  updatedAtServerMs: 1_000,
  revision: 3,
};

type FakeTextTrack = { mode: TextTrackMode; cues: unknown[] };

/** jsdom has no TextTrack or textTracks; give each element a minimal stand-in. */
function installFakeTextTracks() {
  const tracks = new WeakMap<HTMLTrackElement, FakeTextTrack>();
  const lists = new WeakMap<HTMLMediaElement, EventTarget>();
  Object.defineProperty(HTMLTrackElement.prototype, "track", {
    configurable: true,
    get(this: HTMLTrackElement) {
      let track = tracks.get(this);
      if (!track) {
        track = { mode: "disabled", cues: [] };
        tracks.set(this, track);
      }
      return track;
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "textTracks", {
    configurable: true,
    get(this: HTMLMediaElement) {
      let list = lists.get(this);
      if (!list) {
        list = new EventTarget();
        lists.set(this, list);
      }
      return list;
    },
  });
}

function removeFakeTextTracks() {
  Reflect.deleteProperty(HTMLTrackElement.prototype, "track");
  Reflect.deleteProperty(HTMLMediaElement.prototype, "textTracks");
}

function renderPlayer(
  props: { src: string | null; subtitle: VideoSubtitle | null },
  onSubtitleEnabledChange = vi.fn(),
) {
  const onLocalPlaybackChange = vi.fn();
  const element = (next: { src: string | null; subtitle: VideoSubtitle | null }) => (
    <VideoPlayer
      src={next.src}
      emptyMessage="Nothing yet"
      playback={paused}
      resyncKey={1}
      getServerNowMs={() => 2_000}
      onLocalPlaybackChange={onLocalPlaybackChange}
      subtitle={next.subtitle}
      onSubtitleEnabledChange={onSubtitleEnabledChange}
    />
  );
  const view = render(element(props));
  return {
    ...view,
    onLocalPlaybackChange,
    onSubtitleEnabledChange,
    update: (next: { src: string | null; subtitle: VideoSubtitle | null }) =>
      view.rerender(element(next)),
    video: () => view.container.querySelector("video"),
    tracks: () => [...view.container.querySelectorAll("track")],
  };
}

const english: VideoSubtitle = {
  id: "personal:1",
  url: "blob:sub-1",
  label: "movie.en.srt",
  enabled: true,
};
const french: VideoSubtitle = {
  id: "personal:2",
  url: "blob:sub-2",
  label: "movie.fr.vtt",
  enabled: true,
};
const roomTrack: VideoSubtitle = {
  id: "shared:AAAAAAAAAAAAAAAAAAAAAA",
  url: "blob:room-1",
  label: "room.srt",
  enabled: true,
};

function modeOf(track: HTMLTrackElement | undefined): TextTrackMode | undefined {
  return (track as unknown as { track: FakeTextTrack } | undefined)?.track.mode;
}

describe("VideoPlayer subtitles", () => {
  let load: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    installFakeTextTracks();
    load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    removeFakeTextTracks();
    vi.restoreAllMocks();
  });

  it("renders the subtitle as a showing native track", () => {
    const player = renderPlayer({ src: "blob:video", subtitle: english });

    const [track] = player.tracks();
    expect(player.tracks()).toHaveLength(1);
    expect(track?.getAttribute("kind")).toBe("subtitles");
    expect(track?.getAttribute("src")).toBe("blob:sub-1");
    expect(track?.getAttribute("label")).toBe("movie.en.srt");
    expect(modeOf(track)).toBe("showing");
  });

  it("disables and re-enables by mode only, keeping the video and track", () => {
    const player = renderPlayer({ src: "blob:video", subtitle: english });
    const video = player.video();
    const [track] = player.tracks();

    player.update({ src: "blob:video", subtitle: { ...english, enabled: false } });
    expect(modeOf(track)).toBe("hidden");
    player.update({ src: "blob:video", subtitle: english });
    expect(modeOf(track)).toBe("showing");

    expect(player.video()).toBe(video);
    expect(player.tracks()[0]).toBe(track);
  });

  it("replaces the track without touching the video", () => {
    const player = renderPlayer({ src: "blob:video", subtitle: english });
    const video = player.video();
    const [oldTrack] = player.tracks();

    player.update({ src: "blob:video", subtitle: french });

    const [newTrack] = player.tracks();
    expect(player.tracks()).toHaveLength(1);
    expect(newTrack).not.toBe(oldTrack);
    expect(newTrack?.getAttribute("src")).toBe("blob:sub-2");
    expect(modeOf(newTrack)).toBe("showing");
    expect(player.video()).toBe(video);
    expect(video?.getAttribute("src")).toBe("blob:video");
  });

  it("switches between a personal and a room track without touching the video", () => {
    const player = renderPlayer({ src: "blob:video", subtitle: english });
    const video = player.video();

    player.update({ src: "blob:video", subtitle: roomTrack });
    expect(player.tracks().map((track) => track.getAttribute("src"))).toEqual(["blob:room-1"]);
    expect(modeOf(player.tracks()[0])).toBe("showing");

    player.update({ src: "blob:video", subtitle: english });
    expect(player.tracks().map((track) => track.getAttribute("src"))).toEqual(["blob:sub-1"]);

    expect(player.video()).toBe(video);
    expect(video?.getAttribute("src")).toBe("blob:video");
    expect(load).not.toHaveBeenCalled();
    expect(player.onLocalPlaybackChange).not.toHaveBeenCalled();
  });

  it("removes the track without touching the video", () => {
    const player = renderPlayer({ src: "blob:video", subtitle: english });
    const video = player.video();

    player.update({ src: "blob:video", subtitle: null });

    expect(player.tracks()).toEqual([]);
    expect(player.video()).toBe(video);
    expect(video?.getAttribute("src")).toBe("blob:video");
  });

  it("never reloads the video or sends playback commands for subtitle changes", () => {
    const player = renderPlayer({ src: "blob:video", subtitle: null });

    player.update({ src: "blob:video", subtitle: english });
    player.update({ src: "blob:video", subtitle: { ...english, enabled: false } });
    player.update({ src: "blob:video", subtitle: french });
    player.update({ src: "blob:video", subtitle: null });

    expect(load).not.toHaveBeenCalled();
    expect(player.onLocalPlaybackChange).not.toHaveBeenCalled();
  });

  it("attaches a subtitle picked before the video element exists", () => {
    const player = renderPlayer({ src: null, subtitle: english });
    expect(player.video()).toBeNull();

    player.update({ src: "blob:stream", subtitle: english });

    const [track] = player.tracks();
    expect(track?.getAttribute("src")).toBe("blob:sub-1");
    expect(modeOf(track)).toBe("showing");
  });

  it("re-applies the mode when a new video element mounts", () => {
    const player = renderPlayer({ src: "blob:one", subtitle: { ...english, enabled: false } });
    const firstVideo = player.video();

    player.update({ src: "blob:two", subtitle: { ...english, enabled: false } });

    expect(player.video()).not.toBe(firstVideo);
    expect(modeOf(player.tracks()[0])).toBe("hidden");
  });

  it("follows the browser's own captions menu", () => {
    const player = renderPlayer({ src: "blob:video", subtitle: english });
    const [track] = player.tracks();
    const textTracks = player.video()!.textTracks as unknown as EventTarget;

    act(() => {
      (track as unknown as { track: FakeTextTrack }).track.mode = "disabled";
      textTracks.dispatchEvent(new Event("change"));
    });
    expect(player.onSubtitleEnabledChange).toHaveBeenCalledWith(false);

    player.onSubtitleEnabledChange.mockClear();
    act(() => {
      (track as unknown as { track: FakeTextTrack }).track.mode = "showing";
      textTracks.dispatchEvent(new Event("change"));
    });
    // Already enabled in our state: nothing to report.
    expect(player.onSubtitleEnabledChange).not.toHaveBeenCalled();
  });

  it("still renders where TextTrack is unavailable", () => {
    removeFakeTextTracks();

    const player = renderPlayer({ src: "blob:video", subtitle: english });

    expect(player.tracks()).toHaveLength(1);
  });

  describe("cue positioning", () => {
    /** Stands in for the browser's VTTCue; jsdom has none. */
    class FakeVTTCue {
      line: number | "auto" = "auto";
      snapToLines = true;
      constructor(public text: string) {}
    }

    beforeEach(() => {
      vi.stubGlobal("VTTCue", FakeVTTCue);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const fakeTrackOf = (element: HTMLTrackElement | undefined) =>
      (element as unknown as { track: FakeTextTrack }).track;

    /** Simulate the browser finishing loading `cues` into this track element. */
    function loadCues(element: HTMLTrackElement | undefined, cues: unknown[]) {
      fakeTrackOf(element).cues = cues;
      element?.dispatchEvent(new Event("load"));
    }

    it("raises auto-positioned cues once the track loads", () => {
      const player = renderPlayer({ src: "blob:video", subtitle: english });
      const [track] = player.tracks();
      const cue = new FakeVTTCue("Hello");
      const explicit = new FakeVTTCue("Top");
      explicit.line = 10;

      loadCues(track, [cue, explicit]);

      expect(cue).toMatchObject({ line: DEFAULT_CUE_LINE_PERCENT, snapToLines: false });
      expect(explicit).toMatchObject({ line: 10, snapToLines: true });
    });

    it("positions cues that were already loaded before the effect ran", () => {
      const cue = new FakeVTTCue("Hello");
      const originalTrack = Object.getOwnPropertyDescriptor(HTMLTrackElement.prototype, "track")!;
      Object.defineProperty(HTMLTrackElement.prototype, "track", {
        configurable: true,
        get(this: HTMLTrackElement) {
          const track = originalTrack.get!.call(this) as FakeTextTrack;
          if (track.cues.length === 0) {
            track.cues = [cue];
          }
          return track;
        },
      });

      renderPlayer({ src: "blob:video", subtitle: english });

      expect(cue).toMatchObject({ line: DEFAULT_CUE_LINE_PERCENT, snapToLines: false });
    });

    it("positions personal and room tracks alike, on the same single track", () => {
      const player = renderPlayer({ src: "blob:video", subtitle: english });
      const personalCue = new FakeVTTCue("Mine");
      loadCues(player.tracks()[0], [personalCue]);

      player.update({ src: "blob:video", subtitle: roomTrack });
      const roomCue = new FakeVTTCue("Room");
      loadCues(player.tracks()[0], [roomCue]);

      expect(player.tracks()).toHaveLength(1);
      expect(personalCue.line).toBe(DEFAULT_CUE_LINE_PERCENT);
      expect(roomCue.line).toBe(DEFAULT_CUE_LINE_PERCENT);
    });

    it("stops listening to a replaced track and after unmount", () => {
      const player = renderPlayer({ src: "blob:video", subtitle: english });
      const [oldTrack] = player.tracks();
      const oldFake = fakeTrackOf(oldTrack);

      player.update({ src: "blob:video", subtitle: french });
      const lateCue = new FakeVTTCue("Late");
      oldFake.cues = [lateCue];
      oldTrack?.dispatchEvent(new Event("load"));
      expect(lateCue.line).toBe("auto");

      const [currentTrack] = player.tracks();
      const currentFake = fakeTrackOf(currentTrack);
      player.unmount();
      const afterUnmount = new FakeVTTCue("Gone");
      currentFake.cues = [afterUnmount];
      currentTrack?.dispatchEvent(new Event("load"));
      expect(afterUnmount.line).toBe("auto");
    });

    it("is harmless when the same track loads again", () => {
      const player = renderPlayer({ src: "blob:video", subtitle: english });
      const [track] = player.tracks();
      const cue = new FakeVTTCue("Hello");

      loadCues(track, [cue]);
      track?.dispatchEvent(new Event("load"));
      player.update({ src: "blob:video", subtitle: { ...english, enabled: false } });
      player.update({ src: "blob:video", subtitle: english });

      expect(cue).toMatchObject({ line: DEFAULT_CUE_LINE_PERCENT, snapToLines: false });
    });

    it("never reloads the video or sends playback commands while positioning", () => {
      const player = renderPlayer({ src: "blob:video", subtitle: english });
      const video = player.video();

      loadCues(player.tracks()[0], [new FakeVTTCue("Hello")]);

      expect(player.video()).toBe(video);
      expect(video?.getAttribute("src")).toBe("blob:video");
      expect(load).not.toHaveBeenCalled();
      expect(player.onLocalPlaybackChange).not.toHaveBeenCalled();
    });
  });
});
