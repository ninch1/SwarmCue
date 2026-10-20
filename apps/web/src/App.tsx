import { useEffect, useRef, useState } from "react";
import { FileSelect } from "./components/FileSelect.js";
import { GeneratedMagnet } from "./components/GeneratedMagnet.js";
import { MagnetPaste } from "./components/MagnetPaste.js";
import {
  MagnetStatus,
  type MagnetPlaybackState,
} from "./components/MagnetStatus.js";
import { VideoPlayer } from "./components/VideoPlayer.js";
import { isMagnetUri } from "./media/magnet.js";
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
  const [source, setSource] = useState<MediaSource>({ kind: "none" });
  const [magnetError, setMagnetError] = useState<string | null>(null);
  const [magnetGeneration, setMagnetGeneration] = useState<MagnetGeneration>(
    idleMagnetGeneration,
  );
  const [torrentStats, setTorrentStats] = useState<TorrentStats | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const magnetRequestIdRef = useRef(0);

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

  function clearObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  function handleFileSelected(file: File) {
    const requestId = ++magnetRequestIdRef.current;
    setMagnetError(null);
    setPlayerError(null);
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

  function handleMagnetSubmit(rawMagnet: string) {
    const magnetUri = rawMagnet.trim();
    if (!isMagnetUri(magnetUri)) {
      setMagnetError(
        "Enter a valid magnet link (must include xt=urn:btih:…).",
      );
      return;
    }

    const requestId = ++magnetRequestIdRef.current;
    setMagnetError(null);
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

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-5 py-6 pb-10">
      <header>
        <h1 className="m-0 text-[clamp(1.75rem,4vw,2.25rem)] tracking-tight">
          SwarmCue
        </h1>
        <p className="mt-1.5 text-muted">
          Play a local file and share its magnet, or stream a magnet from
          another client.
        </p>
      </header>

      <VideoPlayer
        src={videoSrc}
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

      <GeneratedMagnet
        magnetUri={magnetGeneration.magnetUri}
        status={magnetGeneration.status}
        error={magnetGeneration.error}
      />
    </div>
  );
}
