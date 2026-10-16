import { useEffect, useRef, useState } from "react";
import { FileSelect } from "./components/FileSelect.js";
import { GeneratedMagnet } from "./components/GeneratedMagnet.js";
import { MagnetPaste } from "./components/MagnetPaste.js";
import { VideoPlayer } from "./components/VideoPlayer.js";
import { isMagnetUri } from "./media/magnet.js";
import {
  clearSeededTorrent,
  createMagnetFromFile,
  destroyTorrentClient,
} from "./torrent/client.js";

type MediaSource =
  | { kind: "none" }
  | { kind: "file"; fileName: string; objectUrl: string }
  | { kind: "magnet"; magnetUri: string };

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

export function App() {
  const [source, setSource] = useState<MediaSource>({ kind: "none" });
  const [magnetError, setMagnetError] = useState<string | null>(null);
  const [magnetGeneration, setMagnetGeneration] = useState<MagnetGeneration>(
    idleMagnetGeneration,
  );
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
        const message =
          error instanceof Error
            ? error.message
            : "Failed to create magnet from file.";
        setMagnetGeneration({
          status: "error",
          magnetUri: null,
          error: message,
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

    magnetRequestIdRef.current += 1;
    setMagnetError(null);
    clearObjectUrl();
    setMagnetGeneration(idleMagnetGeneration);
    void clearSeededTorrent();
    setSource({ kind: "magnet", magnetUri });
  }

  const videoSrc = source.kind === "file" ? source.objectUrl : null;
  const fileName = source.kind === "file" ? source.fileName : null;
  const pastedMagnetUri = source.kind === "magnet" ? source.magnetUri : null;

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-5 py-6 pb-10">
      <header>
        <h1 className="m-0 text-[clamp(1.75rem,4vw,2.25rem)] tracking-tight">
          SwarmCue
        </h1>
        <p className="mt-1.5 text-muted">
          Local preview + magnet generation. WebTorrent streaming comes next.
        </p>
      </header>

      <VideoPlayer src={videoSrc} />

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

      {source.kind === "magnet" ? (
        <p
          className="m-0 rounded-[10px] border border-dashed border-border px-3.5 py-3 text-sm text-muted"
          role="status"
        >
          Magnet captured. Playback from magnets will appear here once streaming
          is wired.
        </p>
      ) : null}
    </div>
  );
}
