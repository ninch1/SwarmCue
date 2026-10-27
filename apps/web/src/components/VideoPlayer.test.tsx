// @vitest-environment jsdom
import type { PlaybackState } from "@swarmcue/protocol";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoPlayer, type VideoSubtitle } from "./VideoPlayer.js";

const paused: PlaybackState = {
  status: "paused",
  positionSeconds: 12,
  updatedAtServerMs: 1_000,
  revision: 3,
};

type FakeTextTrack = { mode: TextTrackMode };

/** jsdom has no TextTrack or textTracks; give each element a minimal stand-in. */
function installFakeTextTracks() {
  const tracks = new WeakMap<HTMLTrackElement, FakeTextTrack>();
  const lists = new WeakMap<HTMLMediaElement, EventTarget>();
  Object.defineProperty(HTMLTrackElement.prototype, "track", {
    configurable: true,
    get(this: HTMLTrackElement) {
      let track = tracks.get(this);
      if (!track) {
        track = { mode: "disabled" };
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

const english: VideoSubtitle = { id: 1, url: "blob:sub-1", label: "movie.en.srt", enabled: true };
const french: VideoSubtitle = { id: 2, url: "blob:sub-2", label: "movie.fr.vtt", enabled: true };

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
});
