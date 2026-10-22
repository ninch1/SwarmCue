import type { PlaybackState, PlaybackStatus } from "@swarmcue/protocol";
import { useRef } from "react";
import { usePlaybackSync } from "../player/usePlaybackSync.js";

type VideoPlayerProps = {
  src: string | null;
  /** Shown under "No media loaded" when there is no source. */
  emptyMessage: string;
  /** The room's play/pause state; null outside a room. */
  playback: PlaybackState | null;
  /** Called when this user plays or pauses the video. */
  onLocalPlaybackChange: (status: PlaybackStatus) => void;
  onError?: () => void;
};

export function VideoPlayer({
  src,
  emptyMessage,
  playback,
  onLocalPlaybackChange,
  onError,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { blocked } = usePlaybackSync(
    videoRef,
    src,
    playback,
    onLocalPlaybackChange,
  );

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
