import { useId } from "react";

type SubtitleControlProps = {
  /** The active subtitle's file name, or null when none is loaded. */
  fileName: string | null;
  enabled: boolean;
  /** SRT entries that could not be read and were left out. */
  skippedBlocks: number;
  loading: boolean;
  error: { fileName: string; message: string } | null;
  onFileSelected: (file: File) => void;
  onEnabledChange: (enabled: boolean) => void;
  onRemove: () => void;
};

const buttonClass =
  "inline-flex items-center justify-center rounded-md border border-border bg-panel px-2.5 py-1 text-ink hover:border-accent disabled:cursor-default disabled:opacity-50 disabled:hover:border-border";

/** Personal subtitles: visible only to this participant, never sent to the room. */
export function SubtitleControl({
  fileName,
  enabled,
  skippedBlocks,
  loading,
  error,
  onFileSelected,
  onEnabledChange,
  onRemove,
}: SubtitleControlProps) {
  const id = useId();

  const fileInput = (
    <label
      className={`inline-flex ${loading ? "pointer-events-none" : "cursor-pointer"}`}
      htmlFor={`${id}-file`}
    >
      <span className={`${buttonClass} ${loading ? "opacity-50" : ""}`}>
        {fileName ? "Replace" : "Add subtitles"}
      </span>
      <input
        id={`${id}-file`}
        type="file"
        accept=".srt,.vtt"
        disabled={loading}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onFileSelected(file);
          }
          // Allow picking the same file again.
          event.target.value = "";
        }}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-1.5 text-sm" aria-label="Subtitles" role="group">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Subtitles</span>
        {fileName ? (
          <>
            <span className="min-w-0 max-w-[18rem] truncate text-ink" title={fileName}>
              {fileName}
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-muted">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => onEnabledChange(event.target.checked)}
                className="accent-accent"
              />
              Show
            </label>
            {fileInput}
            <button type="button" className={buttonClass} disabled={loading} onClick={onRemove}>
              Remove
            </button>
          </>
        ) : (
          fileInput
        )}
        {loading ? (
          <span className="text-muted" role="status">
            Reading…
          </span>
        ) : null}
      </div>
      {fileName && skippedBlocks > 0 ? (
        <p className="m-0 text-muted">
          {skippedBlocks === 1
            ? "1 entry could not be read and was skipped."
            : `${skippedBlocks} entries could not be read and were skipped.`}
        </p>
      ) : null}
      {error ? (
        <p className="m-0 text-danger" role="alert">
          Couldn't use <span className="break-all">{error.fileName}</span>. {error.message}
        </p>
      ) : null}
    </div>
  );
}
