import type { PlaybackState } from "@swarmcue/protocol";
import { useRef } from "react";
import {
  usePlaybackSync,
  type LocalPlaybackChange,
} from "../player/usePlaybackSync.js";

type VideoPlayerProps = {
  src: string | null;
  /** Shown under "No media loaded" when there is no source. */
  emptyMessage: string;
  /** The room's playback timeline; null outside a room. */
  playback: PlaybackState | null;
  /** Estimated current server time in epoch ms. */
  getServerNowMs: () => number;
  /** Called when this user plays, pauses, or seeks the video. */
  onLocalPlaybackChange: (change: LocalPlaybackChange) => void;
  onError?: () => void;
};

export function VideoPlayer({
  src,
  emptyMessage,
  playback,
  getServerNowMs,
  onLocalPlaybackChange,
  onError,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { blocked } = usePlaybackSync(videoRef, src, playback, {
    getServerNowMs,
    onLocalChange: onLocalPlaybackChange,
  });

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
          />
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
