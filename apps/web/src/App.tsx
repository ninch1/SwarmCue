import { useEffect, useRef, useState } from "react";
import { FileSelect } from "./components/FileSelect.js";
import {
  MagnetStatus,
  type MagnetPlaybackState,
} from "./components/MagnetStatus.js";
import { RoomPanel } from "./components/RoomPanel.js";
import {
  SharingStatus,
  type SharingState,
} from "./components/SharingStatus.js";
import { VideoPlayer } from "./components/VideoPlayer.js";
import { toMediaName } from "./media/mediaName.js";
import { useRoom } from "./room/useRoom.js";
import {
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

  const inRoom = room.state.status === "in-room";
  const isHost =
    room.state.status === "in-room" &&
    room.state.selfId === room.state.snapshot.hostId;
  const sharedMagnetUri =
    room.state.status === "in-room"
      ? (room.state.snapshot.media?.magnetUri ?? null)
      : null;

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

  // Viewers load whatever the host shares. The <video> gets a source but no
  // autoPlay, so playback never starts on its own. The host keeps its own
  // local playback and never loads the magnet it shared.
  useEffect(() => {
    if (!inRoom || isHost || !sharedMagnetUri) {
      return;
    }
    if (loadedMagnetRef.current === sharedMagnetUri) {
      return;
    }
    loadMagnet(sharedMagnetUri);
  }, [inRoom, isHost, sharedMagnetUri]);

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
        setShareError(
          room.setMedia({
            magnetUri,
            name: toMediaName(file.name),
            sizeBytes: file.size,
          }),
        );
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
  } else if (hostMagnetUri && hostMagnetUri === sharedMagnetUri) {
    sharing = { status: "shared", otherParticipants };
  } else if (hostMagnetUri && roomError) {
    sharing = {
      status: "error",
      message: `Could not share with the room: ${roomError}`,
    };
  } else if (hostMagnetUri) {
    sharing = { status: "sharing" };
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

      <VideoPlayer
        src={videoSrc}
        emptyMessage={emptyPlayerMessage}
        onError={() => {
          setPlayerError(
            "The browser could not play this video. Its format or codec may be unsupported.",
          );
        }}
      />

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
