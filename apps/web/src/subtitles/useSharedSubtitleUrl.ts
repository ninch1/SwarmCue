import type { SubtitleId } from "@swarmcue/protocol";
import { useEffect, useRef, useState } from "react";
import type { SharedSubtitleText } from "../room/roomSession.js";
import { vttObjectUrl } from "./vttObjectUrl.js";

export type SharedSubtitleTrack = { id: SubtitleId; url: string };

/**
 * One object URL per room subtitle id. It is revoked when the subtitle is
 * replaced or removed, or on unmount. The same id delivered again (after a
 * resume) keeps the existing URL.
 */
export function useSharedSubtitleUrl(text: SharedSubtitleText | null): SharedSubtitleTrack | null {
  const [track, setTrack] = useState<SharedSubtitleTrack | null>(null);
  const id = text?.id ?? null;
  const vttRef = useRef(text?.vtt ?? null);
  vttRef.current = text?.vtt ?? null;

  useEffect(() => {
    const vtt = vttRef.current;
    if (id === null || vtt === null) {
      setTrack(null);
      return;
    }
    const url = vttObjectUrl(vtt);
    setTrack({ id, url });
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [id]);

  // Until the effect above has run for a new id, the previous URL is already
  // revoked (or about to be); never hand it out.
  return track && track.id === id ? track : null;
}
