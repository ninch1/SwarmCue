import type { SharedSubtitleMetadata, SubtitleId } from "@swarmcue/protocol";
import { useEffect, useReducer, useRef, useState } from "react";
import type { SubtitleControlProps } from "../components/SubtitleControl.js";
import type { VideoSubtitle } from "../components/VideoPlayer.js";
import type {
  SharedSubtitleText,
  SubtitleShareRequest,
  SubtitleShareStatus,
} from "../room/roomSession.js";
import { readSubtitleFile } from "./readSubtitleFile.js";
import { createSubtitleSharer, type SubtitleShareTarget } from "./shareSubtitleFile.js";
import {
  initialSubtitleSelection,
  subtitleSelectionReducer,
  type SubtitleSource,
} from "./subtitleSelection.js";
import { usePersonalSubtitles } from "./usePersonalSubtitles.js";
import { useSharedSubtitleUrl } from "./useSharedSubtitleUrl.js";

export type RoomSubtitle = {
  metadata: SharedSubtitleMetadata;
  /** Null until the text for `metadata.id` has arrived. */
  text: SharedSubtitleText | null;
  sharedByName: string | null;
};

export type UseSubtitlesOptions = {
  /** What the player shows; personal subtitles and the selection reset when it changes. */
  mediaKey: string | null;
  /** The room's subtitle, only while the player shows the room's media. */
  room: RoomSubtitle | null;
  /** Where a shared subtitle would go; null when sharing is not possible. */
  shareTarget: SubtitleShareTarget | null;
  shareStatus: SubtitleShareStatus;
  selfId: string | null;
  setSubtitle: (request: SubtitleShareRequest) => string | null;
  removeSubtitle: (id: SubtitleId) => string | null;
};

export type UseSubtitles = {
  /** The one track the video shows (hidden while off), or null. */
  track: VideoSubtitle | null;
  /** The browser's captions menu switched the track on or off. */
  onTrackEnabledChange: (enabled: boolean) => void;
  control: SubtitleControlProps;
};

/**
 * Personal and room subtitles share one rendering path: a single native
 * <track>. Personal subtitles are owned by their controller, room subtitles
 * by `useSharedSubtitleUrl`; switching between them never revokes either.
 */
export function useSubtitles({
  mediaKey,
  room,
  shareTarget,
  shareStatus,
  selfId,
  setSubtitle,
  removeSubtitle,
}: UseSubtitlesOptions): UseSubtitles {
  const personal = usePersonalSubtitles(mediaKey);
  const sharedTrack = useSharedSubtitleUrl(room?.text ?? null);
  const [selection, dispatch] = useReducer(subtitleSelectionReducer, initialSubtitleSelection);
  const [reading, setReading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const shareTargetRef = useRef(shareTarget);
  shareTargetRef.current = shareTarget;
  const setSubtitleRef = useRef(setSubtitle);
  setSubtitleRef.current = setSubtitle;
  const [sharer] = useState(() =>
    createSubtitleSharer({
      readFile: readSubtitleFile,
      currentTarget: () => shareTargetRef.current,
      send: (request) => setSubtitleRef.current(request),
    }),
  );

  // Effects run in order: a media change resets first, then the personal
  // and room subtitles report what is available for the new media.
  const previousMediaKeyRef = useRef(mediaKey);
  useEffect(() => {
    if (previousMediaKeyRef.current !== mediaKey) {
      previousMediaKeyRef.current = mediaKey;
      sharer.cancel();
      dispatch({ type: "reset" });
      setReading(false);
      setShareError(null);
      setNotice(null);
    }
  }, [mediaKey, sharer]);

  const personalId = personal.subtitle?.id ?? null;
  const previousPersonalIdRef = useRef(personalId);
  useEffect(() => {
    if (previousPersonalIdRef.current !== personalId) {
      previousPersonalIdRef.current = personalId;
      dispatch({ type: personalId === null ? "personalRemoved" : "personalLoaded" });
    }
  }, [personalId]);

  const sharedId = sharedTrack?.id ?? null;
  const previousSharedIdRef = useRef<SubtitleId | null>(null);
  useEffect(() => {
    if (previousSharedIdRef.current === sharedId) {
      return;
    }
    previousSharedIdRef.current = sharedId;
    if (sharedId === null) {
      dispatch({ type: "sharedRemoved" });
      setNotice(null);
      return;
    }
    dispatch({ type: "sharedArrived" });
    if (selection.active === "personal" && room && room.metadata.sharedBy !== selfId) {
      setNotice(`${room.sharedByName ?? "Someone"} shared ${room.metadata.name}.`);
    }
    // Only a new id matters here; the selection and names are read as of that render.
  }, [sharedId]);

  const shareTargetKey = shareTarget?.key ?? null;
  useEffect(() => {
    setShareError(null);
  }, [shareTargetKey]);

  async function share(file: File) {
    setShareError(null);
    setReading(true);
    const outcome = await sharer.share(file);
    if (outcome.status === "stale") {
      return;
    }
    setReading(false);
    if (outcome.status === "failed") {
      setShareError(outcome.message);
    } else {
      dispatch({ type: "sharing" });
    }
  }

  function select(source: SubtitleSource) {
    setNotice(null);
    dispatch({ type: "select", source });
  }

  const shown = selection.active !== "off" ? selection.active : selection.last;
  let track: VideoSubtitle | null = null;
  if (shown === "personal" && personal.subtitle) {
    track = {
      id: `personal:${personal.subtitle.id}`,
      url: personal.subtitle.url,
      label: personal.subtitle.fileName,
      enabled: selection.active === "personal",
    };
  } else if (shown === "shared" && sharedTrack && room) {
    track = {
      id: `shared:${sharedTrack.id}`,
      url: sharedTrack.url,
      label: room.metadata.name,
      enabled: selection.active === "shared",
    };
  }

  return {
    track,
    onTrackEnabledChange: (enabled) => {
      if (!enabled) {
        select("off");
      } else if (shown) {
        select(shown);
      }
    },
    control: {
      active: selection.active,
      onSelect: select,
      personal: personal.subtitle
        ? { fileName: personal.subtitle.fileName, skippedBlocks: personal.subtitle.skippedBlocks }
        : null,
      personalLoading: personal.loading,
      personalError: personal.error,
      onPersonalFile: personal.select,
      onPersonalRemove: personal.remove,
      room: room
        ? { name: room.metadata.name, sharedByName: room.sharedByName, ready: sharedTrack !== null }
        : null,
      canShare: shareTarget !== null,
      shareBusy: reading || shareStatus.status === "sending",
      shareError: shareError ?? (shareStatus.status === "failed" ? shareStatus.message : null),
      onShareFile: (file) => void share(file),
      onRoomRemove: () => {
        if (room) {
          setShareError(removeSubtitle(room.metadata.id));
        }
      },
      notice,
    },
  };
}
