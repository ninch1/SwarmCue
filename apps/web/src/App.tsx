import { useEffect, useRef, useState } from "react";
import { FileSelect } from "./components/FileSelect.js";
import { MagnetPaste } from "./components/MagnetPaste.js";
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
import { isMagnetUri, magnetMetadata, toMediaName } from "./media/magnet.js";
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
  const [magnetError, setMagnetError] = useState<string | null>(null);
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
    setMagnetError(null);
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
          error: errorMessage(error, "Failed to create magnet from file."),
        });
      });
  }

  /** Host: paste a magnet, play it locally, and share it with the room. */
  function handleMagnetSubmit(rawMagnet: string) {
    const magnetUri = rawMagnet.trim();
    if (!isMagnetUri(magnetUri)) {
      setMagnetError(
        "Enter a valid magnet link (must include xt=urn:btih:…).",
      );
      return;
    }

    loadMagnet(magnetUri);
    setShareError(room.setMedia({ magnetUri, ...magnetMetadata(magnetUri) }));
  }

  /** Stream a magnet into the local player. Used by the host's paste and by viewers. */
  function loadMagnet(magnetUri: string) {
    const requestId = ++magnetRequestIdRef.current;
    loadedMagnetRef.current = magnetUri;
    setMagnetError(null);
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
            error: errorMessage(error, "Failed to load magnet."),
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
  const pastedMagnetUri = source.kind === "magnet" ? source.magnetUri : null;

  // The host's media counts as shared only once a server snapshot carries it.
  const hostMagnetUri =
    magnetGeneration.status === "ready"
      ? magnetGeneration.magnetUri
      : pastedMagnetUri;
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
    emptyPlayerMessage = "Choose a local video file or paste a magnet link.";
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
          Create or join a room. The host shares a video, and everyone else
          streams it from the host.
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
          <div className="grid gap-4 min-[720px]:grid-cols-2">
            <FileSelect
              fileName={fileName}
              onFileSelected={handleFileSelected}
              disabled={magnetGeneration.status === "creating"}
            />
            <MagnetPaste
              magnetUri={pastedMagnetUri}
              error={magnetError}
              onMagnetSubmit={handleMagnetSubmit}
              disabled={magnetGeneration.status === "creating"}
            />
          </div>

          {sharing ? <SharingStatus state={sharing} /> : null}
        </>
      ) : null}
    </div>
  );
}
