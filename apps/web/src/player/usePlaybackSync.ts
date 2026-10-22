import type { PlaybackState, PlaybackStatus } from "@swarmcue/protocol";
import { useEffect, useRef, useState, type RefObject } from "react";

export type PlaybackSync = {
  /** The browser refused to start playback without a user gesture. */
  blocked: boolean;
};

/**
 * Keeps a <video> element's play/pause state in line with the room.
 *
 * - Room state is applied when its revision changes or a new element mounts
 *   (each `src` gets a fresh element).
 * - play/pause events caused by applying room state are ignored; any other
 *   play/pause event came from this user and is reported via `onLocalChange`.
 */
export function usePlaybackSync(
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string | null,
  playback: PlaybackState | null,
  onLocalChange: (status: PlaybackStatus) => void,
): PlaybackSync {
  const [blocked, setBlocked] = useState(false);
  /** Status we are applying from the room; its matching event is not re-sent. */
  const expectedRef = useRef<PlaybackStatus | null>(null);
  const onLocalChangeRef = useRef(onLocalChange);
  onLocalChangeRef.current = onLocalChange;
  const inRoomRef = useRef(playback !== null);
  inRoomRef.current = playback !== null;

  useEffect(() => {
    expectedRef.current = null;
    setBlocked(false);
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handlePlay = () => {
      setBlocked(false);
      if (expectedRef.current === "playing") {
        expectedRef.current = null;
        return;
      }
      if (inRoomRef.current) {
        onLocalChangeRef.current("playing");
      }
    };
    // Also fires when the video reaches its end, which pauses the room too.
    const handlePause = () => {
      if (expectedRef.current === "paused") {
        expectedRef.current = null;
        return;
      }
      if (inRoomRef.current) {
        onLocalChangeRef.current("paused");
      }
    };

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
    };
  }, [videoRef, src]);

  const status = playback?.status ?? null;
  const revision = playback?.revision ?? null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || status === null) {
      return;
    }

    if (status === "paused") {
      setBlocked(false);
      if (!video.paused) {
        expectedRef.current = "paused";
        video.pause();
      }
      return;
    }

    if (video.paused) {
      expectedRef.current = "playing";
      video.play().catch((error: unknown) => {
        expectedRef.current = null;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          setBlocked(true);
        }
        // AbortError means a pause interrupted play(); nothing to do.
      });
    }
  }, [videoRef, src, status, revision]);

  return { blocked };
}
