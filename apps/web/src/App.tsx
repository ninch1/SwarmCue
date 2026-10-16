import { useEffect, useRef, useState } from "react";
import { FileSelect } from "./components/FileSelect.js";
import { MagnetPaste } from "./components/MagnetPaste.js";
import { VideoPlayer } from "./components/VideoPlayer.js";
import { isMagnetUri } from "./media/magnet.js";

type MediaSource =
  | { kind: "none" }
  | { kind: "file"; fileName: string; objectUrl: string }
  | { kind: "magnet"; magnetUri: string };

export function App() {
  const [source, setSource] = useState<MediaSource>({ kind: "none" });
  const [magnetError, setMagnetError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  function clearObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  function handleFileSelected(file: File) {
    setMagnetError(null);
    clearObjectUrl();
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    setSource({
      kind: "file",
      fileName: file.name,
      objectUrl,
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

    setMagnetError(null);
    clearObjectUrl();
    setSource({ kind: "magnet", magnetUri });
  }

  const videoSrc = source.kind === "file" ? source.objectUrl : null;
  const fileName = source.kind === "file" ? source.fileName : null;
  const magnetUri = source.kind === "magnet" ? source.magnetUri : null;

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-5 py-6 pb-10">
      <header>
        <h1 className="m-0 text-[clamp(1.75rem,4vw,2.25rem)] tracking-tight">
          SwarmCue
        </h1>
        <p className="mt-1.5 text-muted">
          Local preview shell — WebTorrent comes next.
        </p>
      </header>

      <VideoPlayer src={videoSrc} />

      <div className="grid gap-4 min-[720px]:grid-cols-2">
        <FileSelect fileName={fileName} onFileSelected={handleFileSelected} />
        <MagnetPaste
          magnetUri={magnetUri}
          error={magnetError}
          onMagnetSubmit={handleMagnetSubmit}
        />
      </div>

      {source.kind === "magnet" ? (
        <p
          className="m-0 rounded-[10px] border border-dashed border-border px-3.5 py-3 text-sm text-muted"
          role="status"
        >
          Magnet captured. Playback will appear here once WebTorrent is wired.
        </p>
      ) : null}
    </div>
  );
}
