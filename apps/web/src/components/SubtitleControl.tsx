import { useId, useState } from "react";
import type { SubtitleSource } from "../subtitles/subtitleSelection.js";

export type SubtitleControlProps = {
  /** What this participant sees; changing it never affects anyone else. */
  active: SubtitleSource;
  onSelect: (source: SubtitleSource) => void;
  personal: { fileName: string; skippedBlocks: number } | null;
  personalLoading: boolean;
  personalError: { fileName: string; message: string } | null;
  onPersonalFile: (file: File) => void;
  onPersonalRemove: () => void;
  /** The room's shared subtitle; `ready` once its text has arrived. */
  room: { name: string; sharedByName: string | null; ready: boolean } | null;
  canShare: boolean;
  shareBusy: boolean;
  shareError: string | null;
  onShareFile: (file: File) => void;
  onRoomRemove: () => void;
  /** E.g. a new room subtitle arrived while this participant uses their own. */
  notice: string | null;
};

const buttonBaseClass =
  "inline-flex items-center justify-center rounded-md border border-border bg-panel px-2.5 py-1 hover:border-accent disabled:cursor-default disabled:opacity-50 disabled:hover:border-border";
const buttonClass = `${buttonBaseClass} text-ink`;
/** For actions that affect everyone in the room. */
const dangerButtonClass = `${buttonBaseClass} text-danger`;

function FileButton({
  label,
  disabled,
  onFile,
}: {
  label: string;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const id = useId();
  return (
    <label
      className={`inline-flex ${disabled ? "pointer-events-none" : "cursor-pointer"}`}
      htmlFor={id}
    >
      <span className={`${buttonClass} ${disabled ? "opacity-50" : ""}`}>{label}</span>
      <input
        id={id}
        type="file"
        accept=".srt,.vtt"
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onFile(file);
          }
          // Allow picking the same file again.
          event.target.value = "";
        }}
      />
    </label>
  );
}

/**
 * Compact subtitle control under the video. The row picks what this
 * participant sees (off, the room's subtitle, or their own); "Manage" opens
 * file actions, where room actions are labeled as affecting everyone.
 */
export function SubtitleControl({
  active,
  onSelect,
  personal,
  personalLoading,
  personalError,
  onPersonalFile,
  onPersonalRemove,
  room,
  canShare,
  shareBusy,
  shareError,
  onShareFile,
  onRoomRemove,
  notice,
}: SubtitleControlProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  const segment = (source: SubtitleSource, label: string, title: string, disabled: boolean) => (
    <label
      className="max-w-[14rem] cursor-pointer truncate px-2.5 py-1 text-muted has-checked:bg-panel has-checked:text-ink has-disabled:cursor-default has-disabled:opacity-50 has-focus-visible:outline-2 has-focus-visible:outline-accent"
      title={title}
    >
      <input
        type="radio"
        name={`${id}-source`}
        value={source}
        checked={active === source}
        disabled={disabled}
        onChange={() => onSelect(source)}
        className="sr-only"
      />
      <bdi>{label}</bdi>
    </label>
  );

  const roomLabel = room ? `Room: ${room.ready ? room.name : "loading…"}` : "Room";
  const personalLabel = personal ? `Mine: ${personal.fileName}` : "Mine";

  return (
    <div className="flex flex-col gap-1.5 text-sm" role="group" aria-labelledby={`${id}-label`}>
      <div className="flex flex-wrap items-center gap-2">
        <span id={`${id}-label`} className="text-muted">
          Subtitles
        </span>
        <div
          role="radiogroup"
          aria-label="Show subtitles for me"
          className="inline-flex min-w-0 divide-x divide-border overflow-hidden rounded-md border border-border"
        >
          {segment("off", "Off", "Turn subtitles off for me", false)}
          {segment("shared", roomLabel, room ? `Room: ${room.name}` : "No room subtitle", !room)}
          {segment(
            "personal",
            personalLabel,
            personal ? `Mine: ${personal.fileName}` : "No subtitle of your own",
            !personal,
          )}
        </div>
        <button
          type="button"
          className={buttonClass}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((value) => !value)}
        >
          Manage {open ? "▴" : "▾"}
        </button>
        {personalLoading ? (
          <span className="text-muted" role="status">
            Reading…
          </span>
        ) : null}
        {shareBusy ? (
          <span className="text-muted" role="status">
            Sharing…
          </span>
        ) : null}
      </div>

      {open ? (
        <div
          id={`${id}-panel`}
          className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="My subtitle">
            <span className="w-12 text-muted">Mine</span>
            <FileButton
              label={personal ? "Replace" : "Add file"}
              disabled={personalLoading}
              onFile={onPersonalFile}
            />
            {personal ? (
              <button
                type="button"
                className={buttonClass}
                disabled={personalLoading}
                onClick={onPersonalRemove}
              >
                Remove
              </button>
            ) : null}
            <span className="text-muted">Only you see it.</span>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Room subtitle">
            <span className="w-12 text-muted">Room</span>
            <FileButton
              label={room ? "Replace for everyone" : "Share a file with the room"}
              disabled={!canShare || shareBusy}
              onFile={onShareFile}
            />
            {room ? (
              <button type="button" className={dangerButtonClass} onClick={onRoomRemove}>
                Remove for everyone
              </button>
            ) : null}
            {room?.sharedByName ? (
              <span className="text-muted">
                Shared by <bdi>{room.sharedByName}</bdi>
              </span>
            ) : null}
            {!canShare ? (
              <span className="text-muted">Available once the room's video is playing here.</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {notice ? <p className="m-0 text-muted">{notice}</p> : null}
      {personal && personal.skippedBlocks > 0 ? (
        <p className="m-0 text-muted">
          {personal.skippedBlocks === 1
            ? "1 entry of your subtitle could not be read and was skipped."
            : `${personal.skippedBlocks} entries of your subtitle could not be read and were skipped.`}
        </p>
      ) : null}
      {personalError ? (
        <p className="m-0 text-danger" role="alert">
          Couldn't use <bdi className="break-all">{personalError.fileName}</bdi>.{" "}
          {personalError.message}
        </p>
      ) : null}
      {shareError ? (
        <p className="m-0 text-danger" role="alert">
          Couldn't share the subtitle. {shareError}
        </p>
      ) : null}
    </div>
  );
}
