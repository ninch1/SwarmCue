import type { Participant, SharedMedia } from "@swarmcue/protocol";
import { useId, useState, type FormEvent } from "react";
import { formatBytes } from "../media/formatBytes.js";
import { formatRoomCode } from "../room/roomCode.js";
import type { UseRoom } from "../room/useRoom.js";

type RoomPanelProps = {
  room: UseRoom;
};

const panelClass =
  "flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface px-4 py-4";
const inputClass =
  "w-full rounded-lg border border-border bg-input px-2.5 py-2 text-ink outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-accent/70 disabled:opacity-50";
const buttonClass =
  "inline-flex w-fit items-center justify-center rounded-lg border border-border bg-panel px-3.5 py-2 text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50";

export function RoomPanel({ room }: RoomPanelProps) {
  const { state } = room;

  if (state.status === "in-room") {
    return (
      <InRoom
        roomId={state.snapshot.roomId}
        selfId={state.selfId}
        hostId={state.snapshot.hostId}
        participants={state.snapshot.participants}
        media={state.snapshot.media}
        reconnecting={state.connection === "reconnecting"}
        error={state.error}
        onLeave={room.leaveRoom}
      />
    );
  }

  let progress: string | null = null;
  if (state.status === "connecting") {
    progress = "Connecting…";
  } else if (state.status === "resuming") {
    progress = "Rejoining your room…";
  }

  return (
    <RoomEntry
      progress={progress}
      error={state.status === "idle" ? state.error : null}
      onCreate={room.createRoom}
      onJoin={room.joinRoom}
    />
  );
}

type RoomEntryProps = {
  /** Shown while connecting or rejoining; the form is disabled meanwhile. */
  progress: string | null;
  error: string | null;
  onCreate: (displayName: string) => void;
  onJoin: (roomCode: string, displayName: string) => void;
};

function RoomEntry({ progress, error, onCreate, onJoin }: RoomEntryProps) {
  const connecting = progress !== null;
  const id = useId();
  const [displayName, setDisplayName] = useState("");
  const [roomCode, setRoomCode] = useState("");

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onJoin(roomCode, displayName);
  }

  return (
    <section className={panelClass} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="m-0 text-[1.05rem]">
        Room
      </h2>
      <p className="m-0 text-sm text-muted">
        Create a room and share its code, or join one with a code.
      </p>

      <label className="text-sm text-muted" htmlFor={`${id}-name`}>
        Display name
      </label>
      <input
        id={`${id}-name`}
        className={inputClass}
        value={displayName}
        maxLength={32}
        autoComplete="nickname"
        disabled={connecting}
        onChange={(event) => setDisplayName(event.target.value)}
      />

      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={connecting}
          onClick={() => onCreate(displayName)}
        >
          Create room
        </button>

        <form className="flex flex-1 items-end gap-2" onSubmit={handleJoin}>
          <label className="sr-only" htmlFor={`${id}-code`}>
            Room code
          </label>
          <input
            id={`${id}-code`}
            className={`${inputClass} font-mono uppercase`}
            placeholder="K7QM-3XPD"
            value={roomCode}
            maxLength={12}
            autoComplete="off"
            spellCheck={false}
            disabled={connecting}
            onChange={(event) => setRoomCode(event.target.value)}
          />
          <button
            type="submit"
            className={buttonClass}
            disabled={connecting || roomCode.trim().length === 0}
          >
            Join
          </button>
        </form>
      </div>

      {progress ? (
        <p className="m-0 text-sm text-accent" role="status">
          {progress}
        </p>
      ) : null}
      {error ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

type InRoomProps = {
  roomId: string;
  selfId: string;
  hostId: string;
  participants: Participant[];
  media: SharedMedia | null;
  /** This client lost its connection and is trying to resume. */
  reconnecting: boolean;
  error: string | null;
  onLeave: () => void;
};

function InRoom({
  roomId,
  selfId,
  hostId,
  participants,
  media,
  reconnecting,
  error,
  onLeave,
}: InRoomProps) {
  const id = useId();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const displayCode = formatRoomCode(roomId);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(displayCode);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className={panelClass} aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`${id}-title`} className="m-0 text-[1.05rem]">
          Room <span className="font-mono tracking-wider">{displayCode}</span>
        </h2>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            void handleCopy();
          }}
        >
          Copy code
        </button>
        {copyState === "copied" ? (
          <span className="text-sm text-accent" role="status">
            Copied
          </span>
        ) : null}
        {copyState === "failed" ? (
          <span className="text-sm text-danger" role="status">
            Copy failed — select the code manually
          </span>
        ) : null}
        <button type="button" className={`${buttonClass} ml-auto`} onClick={onLeave}>
          Leave
        </button>
      </div>

      {reconnecting ? (
        <p className="m-0 text-sm text-accent" role="status">
          Connection lost. Reconnecting…
        </p>
      ) : null}

      <p className="m-0 text-sm text-muted">
        {participants.length === 1
          ? "1 participant"
          : `${participants.length} participants`}
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-live="polite">
        {participants.map((participant) => (
          <li key={participant.id} className="text-sm">
            {participant.displayName}
            {participant.id === hostId ? (
              <span className="text-accent"> (host)</span>
            ) : null}
            {participant.id === selfId ? (
              <span className="text-muted"> (you)</span>
            ) : null}
            {participant.connected ? null : (
              <span className="text-muted"> (reconnecting…)</span>
            )}
          </li>
        ))}
      </ul>

      <p className="m-0 text-sm text-muted">
        Shared media:{" "}
        {media ? (
          <>
            <span className="text-ink">{media.name ?? "Untitled media"}</span>
            {media.sizeBytes !== null ? ` (${formatBytes(media.sizeBytes)})` : null}
          </>
        ) : (
          "none yet"
        )}
      </p>

      {error ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
