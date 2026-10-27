import { useEffect, useRef, useState } from "react";
import {
  createPersonalSubtitles,
  emptyPersonalSubtitleState,
  type PersonalSubtitles,
  type PersonalSubtitleState,
} from "./personalSubtitles.js";
import { readSubtitleFile } from "./readSubtitleFile.js";

export type UsePersonalSubtitles = PersonalSubtitleState & {
  select: (file: File) => void;
  setEnabled: (enabled: boolean) => void;
  remove: () => void;
};

/**
 * React adapter for the personal subtitle controller. `mediaKey` identifies
 * what the player shows; whenever it changes (new media, another room,
 * leaving), the subtitle is dropped and its object URL revoked.
 */
export function usePersonalSubtitles(mediaKey: string | null): UsePersonalSubtitles {
  const [state, setState] = useState<PersonalSubtitleState>(emptyPersonalSubtitleState);
  const controllerRef = useRef<PersonalSubtitles | null>(null);

  useEffect(() => {
    const controller = createPersonalSubtitles({
      readFile: readSubtitleFile,
      createObjectUrl: (vtt) => URL.createObjectURL(new Blob([vtt], { type: "text/vtt" })),
      revokeObjectUrl: (url) => URL.revokeObjectURL(url),
      onStateChange: setState,
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      setState(emptyPersonalSubtitleState);
    };
  }, []);

  const previousMediaKeyRef = useRef(mediaKey);
  useEffect(() => {
    if (previousMediaKeyRef.current !== mediaKey) {
      previousMediaKeyRef.current = mediaKey;
      controllerRef.current?.reset();
    }
  }, [mediaKey]);

  return {
    ...state,
    select: (file) => void controllerRef.current?.select(file),
    setEnabled: (enabled) => controllerRef.current?.setEnabled(enabled),
    remove: () => controllerRef.current?.remove(),
  };
}
