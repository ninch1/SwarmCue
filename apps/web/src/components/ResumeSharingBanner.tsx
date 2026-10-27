import { useId } from "react";
import { formatBytes } from "../media/formatBytes.js";

type ResumeSharingBannerProps = {
  /** The room's shared media, as last shared by this tab. */
  mediaName: string | null;
  sizeBytes: number | null;
  /** Set when the picked file does not look like the shared one. */
  mismatchFileName: string | null;
  onFileChosen: (file: File) => void;
  onDismiss: () => void;
  onShareMismatchAsNew: () => void;
  onCancelMismatch: () => void;
};

const buttonClass =
  "inline-flex w-fit items-center justify-center rounded-lg border border-border bg-panel px-3.5 py-2 text-ink hover:border-accent";

/**
 * Shown to a host who refreshed: the page cannot keep the selected file, so
 * this tab stopped seeding it. Picking the same file again resumes seeding
 * without restarting the room's playback.
 */
export function ResumeSharingBanner({
  mediaName,
  sizeBytes,
  mismatchFileName,
  onFileChosen,
  onDismiss,
  onShareMismatchAsNew,
  onCancelMismatch,
}: ResumeSharingBannerProps) {
  const id = useId();
  const label = `${mediaName ?? "the shared video"}${
    sizeBytes !== null ? ` (${formatBytes(sizeBytes)})` : ""
  }`;

  if (mismatchFileName !== null) {
    return (
      <section
        className="flex flex-col gap-2.5 rounded-[10px] border border-danger/50 bg-surface px-4 py-4"
        role="alertdialog"
        aria-labelledby={`${id}-title`}
      >
        <p id={`${id}-title`} className="m-0 text-sm text-ink">
          <span className="break-all">{mismatchFileName}</span> doesn't match{" "}
          <span className="break-all">{label}</span>. Share it as new media instead?
          Playback will restart from the beginning for everyone.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={onShareMismatchAsNew}>
            Share as new media
          </button>
          <button type="button" className={buttonClass} onClick={onCancelMismatch}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="flex flex-col gap-2.5 rounded-[10px] border border-accent/50 bg-surface px-4 py-4"
      role="status"
      aria-labelledby={`${id}-title`}
    >
      <p id={`${id}-title`} className="m-0 text-sm text-ink">
        You're no longer sharing <span className="break-all">{label}</span>. Choose the
        same file to keep sharing it. Others can only keep watching the parts they
        have already downloaded.
      </p>
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex w-fit cursor-pointer" htmlFor={`${id}-file`}>
          <span className={buttonClass}>Choose file</span>
          <input
            id={`${id}-file`}
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onFileChosen(file);
              }
              event.target.value = "";
            }}
          />
        </label>
        <button type="button" className={buttonClass} onClick={onDismiss}>
          Not now
        </button>
      </div>
    </section>
  );
}
