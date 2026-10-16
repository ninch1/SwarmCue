import { useId } from "react";

type FileSelectProps = {
  fileName: string | null;
  onFileSelected: (file: File) => void;
  disabled?: boolean;
};

export function FileSelect({
  fileName,
  onFileSelected,
  disabled = false,
}: FileSelectProps) {
  const inputId = useId();

  return (
    <section
      className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface px-4 py-4"
      aria-labelledby={`${inputId}-label`}
    >
      <h2 id={`${inputId}-label`} className="m-0 text-[1.05rem]">
        Local file
      </h2>
      <p className="m-0 text-sm text-muted">
        Play a video from this device. Later this can seed to other peers.
      </p>
      <label className="inline-flex w-fit cursor-pointer" htmlFor={inputId}>
        <span className="inline-flex items-center justify-center rounded-lg border border-border bg-panel px-3.5 py-2 text-ink hover:border-accent">
          Choose video
        </span>
        <input
          id={inputId}
          type="file"
          accept="video/*"
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onFileSelected(file);
            }
            // Allow selecting the same file again after clearing.
            event.target.value = "";
          }}
        />
      </label>
      {fileName ? (
        <p className="m-0 break-all text-sm text-accent" aria-live="polite">
          Selected: {fileName}
        </p>
      ) : null}
    </section>
  );
}
