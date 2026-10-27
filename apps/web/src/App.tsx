import { useEffect, useRef, useState } from "react";
import { FileSelect } from "./components/FileSelect.js";
import {
  MagnetStatus,
  type MagnetPlaybackState,
} from "./components/MagnetStatus.js";
import { ResumeSharingBanner } from "./components/ResumeSharingBanner.js";
import { RoomPanel } from "./components/RoomPanel.js";
import {
  SharingStatus,
  type SharingState,
} from "./components/SharingStatus.js";
import { SubtitleControl } from "./components/SubtitleControl.js";
import { VideoPlayer } from "./components/VideoPlayer.js";
import { infoHashOf, isSameTorrent } from "./media/infoHash.js";
import { toMediaName } from "./media/mediaName.js";
import {
  createSharedMediaMemory,
  type SharedMediaMemory,
} from "./media/sharedMediaMemory.js";
import { browserSessionStorage } from "./room/sessionStore.js";
import { useRoom } from "./room/useRoom.js";
import { useSubtitles } from "./subtitles/useSubtitles.js";
import {
  clearActiveTorrent,
  createMagnetFromFile,
  destroyTorrentClient,
  playMagnet,
  type TorrentStats,
} from "./torrent/client.js";

type MediaSource =
  | { kind: "none" }
  | { kind: "file"; fileName: string; objectUrl: string }
  | { kind: "magnet"; magnetUri: string; playback: MagnetPlaybackState };

type MagnetGeneration =
  | { status: "idle"; magnetUri: null; error: null }
  | { status: "creating"; magnetUri: null; error: null }
  | { status: "ready"; magnetUri: string; error: null }
  | { status: "error"; magnetUri: null; error: string };

const idleMagnetGeneration: MagnetGeneration = {
  status: "idle",
  magnetUri: null,
  error: null,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function App() {
  const room = useRoom();
  const [source, setSource] = useState<MediaSource>({ kind: "none" });
  const [magnetGeneration, setMagnetGeneration] = useState<MagnetGeneration>(
    idleMagnetGeneration,
  );
  const [torrentStats, setTorrentStats] = useState<TorrentStats | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const magnetRequestIdRef = useRef(0);
  /** Last magnet this client started loading; guards the viewer auto-load effect. */
  const loadedMagnetRef = useRef<string | null>(null);
  const [sharedMediaMemory] = useState(() =>
    createSharedMediaMemory(browserSessionStorage()),
  );
  /** The media this tab shared (survives a refresh), so a host can be asked to re-pick it. */
  const [rememberedShare, setRememberedShare] = useState<SharedMediaMemory | null>(
    () => sharedMediaMemory.load(),
  );
  /** Info hash of the shared media the host chose not to re-pick for now. */
  const [dismissedResumeHash, setDismissedResumeHash] = useState<string | null>(null);
  /** A file picked from the re-pick banner that does not look like the shared one. */
  const [resumeMismatch, setResumeMismatch] = useState<File | null>(null);

  const inRoom = room.state.status === "in-room";
  const isHost =
    room.state.status === "in-room" &&
    room.state.selfId === room.state.snapshot.hostId;
  const sharedMagnetUri =
    room.state.status === "in-room"
      ? (room.state.snapshot.media?.magnetUri ?? null)
      : null;
  const playback =
    room.state.status === "in-room" ? room.state.snapshot.playback : null;
  const resyncKey = room.state.status === "in-room" ? room.state.resyncKey : null;
  const sharedMedia =
    room.state.status === "in-room" ? room.state.snapshot.media : null;
  const currentRoomId =
    room.state.status === "in-room" ? room.state.snapshot.roomId : null;
  /** Room state as of the latest render, for async callbacks. */
  const latestRoomRef = useRef({ roomId: currentRoomId, sharedMagnetUri });
  latestRoomRef.current = { roomId: currentRoomId, sharedMagnetUri };

  useEffect(() => {
    return () => {
      magnetRequestIdRef.current += 1;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      destroyTorrentClient();
    };
  }, []);

  // Everyone without a local file loads whatever the room shares: viewers,
  // and a host who refreshed and lost their file. The <video> gets a source
  // but no autoPlay, so playback never starts on its own. A host showing a
  // local file (shared or still being prepared) keeps it.
  const showingLocalFile = source.kind === "file";
  useEffect(() => {
    if (!inRoom || showingLocalFile || !sharedMagnetUri) {
      return;
    }
    if (loadedMagnetRef.current === sharedMagnetUri) {
      return;
    }
    loadMagnet(sharedMagnetUri);
  }, [inRoom, showingLocalFile, sharedMagnetUri]);

  // Local media belongs to one room session. Clear it when that session ends
  // (leave, rejection, giving up) or another room is entered. A reconnect
  // keeps the same room id, so the file and torrent survive it.
  const previousRoomIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousRoomIdRef.current;
    previousRoomIdRef.current = currentRoomId;
    if (previous !== null && previous !== currentRoomId) {
      resetLocalMedia();
    }
  }, [currentRoomId]);

  function resetLocalMedia() {
    // Supersede any file preparation or stream load still in flight.
    magnetRequestIdRef.current += 1;
    loadedMagnetRef.current = null;
    clearObjectUrl();
    setSource({ kind: "none" });
    setMagnetGeneration(idleMagnetGeneration);
    setTorrentStats(null);
    setPlayerError(null);
    setShareError(null);
    sharedMediaMemory.clear();
    setRememberedShare(null);
    setDismissedResumeHash(null);
    setResumeMismatch(null);
    void clearActiveTorrent();
  }

  function clearObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  function handleFileSelected(file: File) {
    const requestId = ++magnetRequestIdRef.current;
    loadedMagnetRef.current = null;
    setPlayerError(null);
    setShareError(null);
    setTorrentStats(null);
    clearObjectUrl();

    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    setSource({
      kind: "file",
      fileName: file.name,
      objectUrl,
    });
    setMagnetGeneration({
      status: "creating",
      magnetUri: null,
      error: null,
    });

    void createMagnetFromFile(file)
      .then((magnetUri) => {
        if (requestId !== magnetRequestIdRef.current) {
          return;
        }
        setMagnetGeneration({
          status: "ready",
          magnetUri,
          error: null,
        });
        const { roomId, sharedMagnetUri: roomMagnetUri } = latestRoomRef.current;
        // The same file always yields the same torrent. Re-picking the room's
        // current media just resumes seeding; sharing it again would restart
        // playback for everyone.
        if (!isSameTorrent(magnetUri, roomMagnetUri)) {
          setShareError(
            room.setMedia({
              magnetUri,
              name: toMediaName(file.name),
              sizeBytes: file.size,
            }),
          );
        }
        const infoHash = infoHashOf(magnetUri);
        if (roomId && infoHash) {
          const memory = { roomId, infoHash };
          sharedMediaMemory.save(memory);
          setRememberedShare(memory);
        }
      })
      .catch((error: unknown) => {
        if (requestId !== magnetRequestIdRef.current) {
          return;
        }
        setMagnetGeneration({
          status: "error",
          magnetUri: null,
          error: errorMessage(error, "Could not prepare this video for sharing."),
        });
      });
  }

  /** Viewers: stream the host's shared video into the local player. */
  function loadMagnet(magnetUri: string) {
    const requestId = ++magnetRequestIdRef.current;
    loadedMagnetRef.current = magnetUri;
    setShareError(null);
    setPlayerError(null);
    setTorrentStats(null);
    clearObjectUrl();
    setMagnetGeneration(idleMagnetGeneration);
    setSource({ kind: "magnet", magnetUri, playback: { status: "loading" } });

    const isCurrent = () => requestId === magnetRequestIdRef.current;

    void playMagnet(magnetUri, (stats) => {
      if (isCurrent()) {
        setTorrentStats(stats);
      }
    })
      .then((playback) => {
        if (!isCurrent()) {
          return;
        }
        setSource({
          kind: "magnet",
          magnetUri,
          playback: { status: "ready", ...playback },
        });
      })
      .catch((error: unknown) => {
        if (!isCurrent()) {
          return;
        }
        setSource({
          kind: "magnet",
          magnetUri,
          playback: {
            status: "error",
            error: errorMessage(error, "Could not load the shared video."),
          },
        });
      });
  }

  let videoSrc: string | null = null;
  if (source.kind === "file") {
    videoSrc = source.objectUrl;
  } else if (source.kind === "magnet" && source.playback.status === "ready") {
    videoSrc = source.playback.streamUrl;
  }
  const fileName = source.kind === "file" ? source.fileName : null;

  // The host's media counts as shared only once a server snapshot carries it.
  const hostMagnetUri = magnetGeneration.magnetUri;
  // A local file that is not (yet) the room's media is a private preview: it
  // must not follow the previous media's timeline or send room commands.
  const localFileIsRoomMedia =
    showingLocalFile && isSameTorrent(hostMagnetUri, sharedMagnetUri);
  const playerPlayback = showingLocalFile && !localFileIsRoomMedia ? null : playback;

  // Subtitles belong to what the player shows. Each picked file is new
  // media; a stream is identified by its torrent, so reconnecting keeps the
  // subtitle while new room media, leaving, or another room drops it.
  let subtitleMediaKey: string | null = null;
  if (source.kind === "file") {
    subtitleMediaKey = `file:${source.objectUrl}`;
  } else if (source.kind === "magnet") {
    subtitleMediaKey = `torrent:${infoHashOf(source.magnetUri) ?? source.magnetUri}`;
  }
  // The room subtitle belongs to the room's media, not to a host's private preview.
  const showsRoomMedia = source.kind === "magnet" || localFileIsRoomMedia;
  const inRoomState = room.state.status === "in-room" ? room.state : null;
  const roomSubtitleMetadata = showsRoomMedia ? (inRoomState?.snapshot.subtitle ?? null) : null;
  const subtitles = useSubtitles({
    mediaKey: subtitleMediaKey,
    room:
      inRoomState && roomSubtitleMetadata
        ? {
            metadata: roomSubtitleMetadata,
            text: inRoomState.sharedSubtitle,
            sharedByName:
              inRoomState.snapshot.participants.find(
                (participant) => participant.id === roomSubtitleMetadata.sharedBy,
              )?.displayName ?? null,
          }
        : null,
    shareTarget:
      showsRoomMedia && currentRoomId && sharedMagnetUri
        ? { mediaMagnetUri: sharedMagnetUri, key: `${currentRoomId}|${sharedMagnetUri}` }
        : null,
    shareStatus: inRoomState?.subtitleShare ?? { status: "idle" },
    selfId: inRoomState?.selfId ?? null,
    setSubtitle: room.setSubtitle,
    removeSubtitle: room.removeSubtitle,
  });
  const roomError = room.state.status === "in-room" ? room.state.error : null;
  const otherParticipants =
    room.state.status === "in-room"
      ? room.state.snapshot.participants.length - 1
      : 0;
  let sharing: SharingState | null = null;
  if (magnetGeneration.status === "creating") {
    sharing = { status: "creating" };
  } else if (magnetGeneration.status === "error") {
    sharing = { status: "error", message: magnetGeneration.error };
  } else if (shareError) {
    sharing = {
      status: "error",
      message: `Could not share with the room: ${shareError}`,
    };
  } else if (isSameTorrent(hostMagnetUri, sharedMagnetUri)) {
    sharing = { status: "shared", otherParticipants };
  } else if (hostMagnetUri && roomError) {
    sharing = {
      status: "error",
      message: `Could not share with the room: ${roomError}`,
    };
  } else if (hostMagnetUri) {
    sharing = { status: "sharing" };
  }

  // A host who refreshed no longer has the file they shared (the page cannot
  // keep it), so offer to pick it again.
  const sharedInfoHash = sharedMagnetUri ? infoHashOf(sharedMagnetUri) : null;
  const showResumeBanner =
    isHost &&
    !showingLocalFile &&
    sharedInfoHash !== null &&
    rememberedShare?.roomId === currentRoomId &&
    rememberedShare.infoHash === sharedInfoHash &&
    dismissedResumeHash !== sharedInfoHash;

  function handleResumeFileChosen(file: File) {
    // Name and size are cheap to compare; the info hash decides for real once
    // the file has been read.
    const looksSame =
      (sharedMedia?.name == null || toMediaName(file.name) === sharedMedia.name) &&
      (sharedMedia?.sizeBytes == null || file.size === sharedMedia.sizeBytes);
    if (looksSame) {
      handleFileSelected(file);
    } else {
      setResumeMismatch(file);
    }
  }

  let emptyPlayerMessage = "Create or join a room to watch together.";
  if (isHost) {
    emptyPlayerMessage = "Choose a video from this device to share with the room.";
  } else if (inRoom) {
    emptyPlayerMessage = sharedMagnetUri
      ? "Loading the host's media…"
      : "Waiting for the host to share media.";
  }

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-5 py-6 pb-10">
      <header>
        <h1 className="m-0 text-[clamp(1.75rem,4vw,2.25rem)] tracking-tight">
          SwarmCue
        </h1>
        <p className="mt-1.5 text-muted">
          Pick a video on your device and watch it with friends. It streams
          directly between everyone in the room.
        </p>
      </header>

      <RoomPanel room={room} />

      {showResumeBanner ? (
        <ResumeSharingBanner
          mediaName={sharedMedia?.name ?? null}
          sizeBytes={sharedMedia?.sizeBytes ?? null}
          mismatchFileName={resumeMismatch?.name ?? null}
          onFileChosen={handleResumeFileChosen}
          onDismiss={() => setDismissedResumeHash(sharedInfoHash)}
          onShareMismatchAsNew={() => {
            const file = resumeMismatch;
            setResumeMismatch(null);
            if (file) {
              handleFileSelected(file);
            }
          }}
          onCancelMismatch={() => setResumeMismatch(null)}
        />
      ) : null}

      <VideoPlayer
        src={videoSrc}
        emptyMessage={emptyPlayerMessage}
        playback={playerPlayback}
        resyncKey={resyncKey}
        // Until the clock is measured, this client's own clock is the best guess.
        getServerNowMs={() => room.estimateServerNowMs() ?? Date.now()}
        onLocalPlaybackChange={({ status, positionSeconds }) => {
          const error = room.setPlayback(status, positionSeconds);
          if (error) {
            console.error("Could not send playback command:", error);
          }
        }}
        subtitle={subtitles.track}
        onSubtitleEnabledChange={subtitles.onTrackEnabledChange}
        onError={() => {
          setPlayerError(
            "The browser could not play this video. Its format or codec may be unsupported.",
          );
        }}
      />

      {subtitleMediaKey !== null ? (
        <SubtitleControl {...subtitles.control} />
      ) : null}

      {playerError ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {playerError}
        </p>
      ) : null}

      {source.kind === "magnet" ? (
        <MagnetStatus playback={source.playback} stats={torrentStats} />
      ) : null}

      {isHost ? (
        <>
          <FileSelect
            fileName={fileName}
            onFileSelected={handleFileSelected}
            disabled={magnetGeneration.status === "creating"}
          />

          {sharing ? <SharingStatus state={sharing} /> : null}
        </>
      ) : null}
    </div>
  );
}
