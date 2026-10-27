import type { PlaybackState } from "@swarmcue/protocol";
import { useEffect, useRef } from "react";
import {
  usePlaybackSync,
  type LocalPlaybackChange,
} from "../player/usePlaybackSync.js";

/** A WebVTT subtitle shown through the video's native text-track rendering. */
export type VideoSubtitle = {
  /** A new id means a new <track> element. */
  id: number;
  url: string;
  label: string;
  enabled: boolean;
};

type VideoPlayerProps = {
  src: string | null;
  /** Shown under "No media loaded" when there is no source. */
  emptyMessage: string;
  /** The room's playback timeline; null outside a room. */
  playback: PlaybackState | null;
  /** Changes on every join or resume, so room state is re-applied after a reconnect. */
  resyncKey: number | null;
  /** Estimated current server time in epoch ms. */
  getServerNowMs: () => number;
  /** Called when this user plays, pauses, or seeks the video. */
  onLocalPlaybackChange: (change: LocalPlaybackChange) => void;
  /** Local only: never affects the source or playback. */
  subtitle?: VideoSubtitle | null;
  /** The user switched the subtitle on or off from the browser's own captions menu. */
  onSubtitleEnabledChange?: (enabled: boolean) => void;
  onError?: () => void;
};

export function VideoPlayer({
  src,
  emptyMessage,
  playback,
  resyncKey,
  getServerNowMs,
  onLocalPlaybackChange,
  subtitle = null,
  onSubtitleEnabledChange,
  onError,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLTrackElement | null>(null);
  const { blocked } = usePlaybackSync(videoRef, src, playback, {
    resyncKey,
    getServerNowMs,
    onLocalChange: onLocalPlaybackChange,
  });

  const subtitleId = subtitle?.id ?? null;
  const subtitleEnabled = subtitle?.enabled ?? false;
  const subtitleEnabledRef = useRef(subtitleEnabled);
  subtitleEnabledRef.current = subtitleEnabled;
  const onSubtitleEnabledChangeRef = useRef(onSubtitleEnabledChange);
  onSubtitleEnabledChangeRef.current = onSubtitleEnabledChange;

  // A <track> starts disabled; set its mode on every new track or video
  // element. "hidden" keeps the cues loaded, so switching back on is instant.
  useEffect(() => {
    const textTrack = trackRef.current?.track;
    if (!textTrack) {
      return;
    }
    const mode = subtitleEnabled ? "showing" : "hidden";
    if (textTrack.mode !== mode) {
      textTrack.mode = mode;
    }
  }, [src, subtitleId, subtitleEnabled]);

  // Native controls have their own captions menu; keep our toggle in step with it.
  useEffect(() => {
    const textTracks = videoRef.current?.textTracks;
    const trackElement = trackRef.current;
    if (!textTracks || !trackElement?.track) {
      return;
    }
    const handleChange = () => {
      const showing = trackElement.track.mode === "showing";
      if (showing !== subtitleEnabledRef.current) {
        onSubtitleEnabledChangeRef.current?.(showing);
      }
    };
    textTracks.addEventListener("change", handleChange);
    return () => {
      textTracks.removeEventListener("change", handleChange);
    };
  }, [src, subtitleId]);

  return (
    <div className="flex flex-col gap-2">
      <section
        className="grid aspect-video place-items-center overflow-hidden rounded-[10px] border border-border bg-black"
        aria-label="Video player"
      >
        {src ? (
          <video
            key={src}
            ref={videoRef}
            src={src}
            controls
            playsInline
            onError={onError}
            className="block h-full w-full bg-black"
          >
            {subtitle ? (
              <track
                key={subtitle.id}
                ref={trackRef}
                kind="subtitles"
                src={subtitle.url}
                label={subtitle.label}
                srcLang="und"
              />
            ) : null}
          </video>
        ) : (
          <div className="px-6 py-6 text-center text-muted">
            <p className="m-0">No media loaded</p>
            <p className="m-0 mt-1.5 text-sm">{emptyMessage}</p>
          </div>
        )}
      </section>
      {src && blocked ? (
        <p className="m-0 text-sm text-accent" role="status">
          Your browser blocked playback. Press play to join the room.
        </p>
      ) : null}
    </div>
  );
}
