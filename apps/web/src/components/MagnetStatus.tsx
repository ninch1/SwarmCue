import type { TorrentStats } from "../torrent/client.js";

export type MagnetPlaybackState =
  | { status: "loading" }
  | { status: "ready"; fileName: string; streamUrl: string }
  | { status: "error"; error: string };

type MagnetStatusProps = {
  playback: MagnetPlaybackState;
  stats: TorrentStats | null;
};

export function MagnetStatus({ playback, stats }: MagnetStatusProps) {
  if (playback.status === "error") {
    return (
      <p
        className="m-0 rounded-[10px] border border-danger/50 px-3.5 py-3 text-sm text-danger"
        role="alert"
      >
        {playback.error}
      </p>
    );
  }

  const peers = stats ? formatPeers(stats.numPeers) : "0 peers";

  return (
    <p
      className="m-0 rounded-[10px] border border-dashed border-border px-3.5 py-3 text-sm text-muted"
      role="status"
    >
      {playback.status === "loading" ? (
        <>Finding peers and fetching torrent metadata… · {peers}</>
      ) : (
        <>
          Streaming <span className="text-ink">{playback.fileName}</span> ·{" "}
          {peers}
          {stats ? (
            <>
              {" "}
              · {Math.floor(stats.progress * 100)}% downloaded ·{" "}
              {formatSpeed(stats.downloadSpeed)}
            </>
          ) : null}
        </>
      )}
    </p>
  );
}

function formatPeers(count: number): string {
  return count === 1 ? "1 peer" : `${count} peers`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${Math.round(bytesPerSecond / 1024)} KB/s`;
}
