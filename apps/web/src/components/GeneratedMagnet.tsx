import { useId, useState } from "react";

type GeneratedMagnetProps = {
  magnetUri: string | null;
  status: "idle" | "creating" | "ready" | "error";
  error: string | null;
};

export function GeneratedMagnet({
  magnetUri,
  status,
  error,
}: GeneratedMagnetProps) {
  const inputId = useId();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  if (status === "idle") {
    return null;
  }

  async function handleCopy() {
    if (!magnetUri) {
      return;
    }

    try {
      await navigator.clipboard.writeText(magnetUri);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section
      className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface px-4 py-4"
      aria-labelledby={`${inputId}-label`}
    >
      <h2 id={`${inputId}-label`} className="m-0 text-[1.05rem]">
        Generated magnet
      </h2>
      <p className="m-0 text-sm text-muted">
        Copy this link into another client. Keep this tab open — it is the
        seeder the other client streams from.
      </p>

      {status === "creating" ? (
        <p className="m-0 text-sm text-accent" role="status">
          Creating torrent and magnet…
        </p>
      ) : null}

      {status === "error" && error ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {status === "ready" && magnetUri ? (
        <>
          <label className="sr-only" htmlFor={inputId}>
            Generated magnet URI
          </label>
          <textarea
            id={inputId}
            className="min-h-24 w-full resize-y rounded-lg border border-border bg-input px-2.5 py-2 font-mono text-sm text-ink outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-accent/70"
            value={magnetUri}
            readOnly
            spellCheck={false}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void handleCopy();
              }}
              className="inline-flex w-fit items-center justify-center rounded-lg border border-border bg-panel px-3.5 py-2 text-ink hover:border-accent"
            >
              Copy magnet
            </button>
            {copyState === "copied" ? (
              <span className="text-sm text-accent" role="status">
                Copied
              </span>
            ) : null}
            {copyState === "failed" ? (
              <span className="text-sm text-danger" role="status">
                Copy failed — select and copy manually
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
