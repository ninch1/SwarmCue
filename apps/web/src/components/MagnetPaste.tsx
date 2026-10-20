import { useId, useState, type FormEvent } from "react";

type MagnetPasteProps = {
  magnetUri: string | null;
  error: string | null;
  onMagnetSubmit: (magnetUri: string) => void;
  disabled?: boolean;
};

export function MagnetPaste({
  magnetUri,
  error,
  onMagnetSubmit,
  disabled = false,
}: MagnetPasteProps) {
  const inputId = useId();
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onMagnetSubmit(draft);
  }

  return (
    <section
      className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface px-4 py-4"
      aria-labelledby={`${inputId}-label`}
    >
      <h2 id={`${inputId}-label`} className="m-0 text-[1.05rem]">
        Magnet link
      </h2>
      <p className="m-0 text-sm text-muted">
        Paste a magnet URI from another client to stream it here.
      </p>
      <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor={inputId}>
          Magnet URI
        </label>
        <input
          id={inputId}
          className="w-full rounded-lg border border-border bg-input px-2.5 py-2 text-ink outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-accent/70"
          type="url"
          name="magnet"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="magnet:?xt=urn:btih:…"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          disabled={disabled || draft.trim().length === 0}
          className="inline-flex w-fit items-center justify-center rounded-lg border border-border bg-panel px-3.5 py-2 text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Use magnet
        </button>
      </form>
      {error ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {magnetUri && !error ? (
        <p className="m-0 break-all text-sm text-accent" aria-live="polite">
          Using magnet: {truncateMagnet(magnetUri)}
        </p>
      ) : null}
    </section>
  );
}

function truncateMagnet(magnetUri: string, maxLength = 64): string {
  if (magnetUri.length <= maxLength) {
    return magnetUri;
  }
  return `${magnetUri.slice(0, maxLength)}…`;
}
