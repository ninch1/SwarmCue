export type SharingState =
  | { status: "creating" }
  /** Sent to the server; waiting for the room snapshot that confirms it. */
  | { status: "sharing" }
  | { status: "shared"; otherParticipants: number }
  | { status: "error"; message: string };

type SharingStatusProps = {
  state: SharingState;
};

/** Host only: whether the host's current media has reached the room. */
export function SharingStatus({ state }: SharingStatusProps) {
  if (state.status === "error") {
    return (
      <p
        className="m-0 rounded-[10px] border border-danger/50 px-3.5 py-3 text-sm text-danger"
        role="alert"
      >
        {state.message}
      </p>
    );
  }

  let message: string;
  switch (state.status) {
    case "creating":
      message = "Preparing your video for the room…";
      break;
    case "sharing":
      message = "Sharing with the room…";
      break;
    case "shared":
      message =
        state.otherParticipants === 0
          ? "Shared with the room. Anyone who joins will load it automatically."
          : `Shared with ${formatOthers(state.otherParticipants)}. Their players load it automatically.`;
      break;
  }

  return (
    <p
      className={`m-0 rounded-[10px] border px-3.5 py-3 text-sm ${
        state.status === "shared"
          ? "border-accent/50 text-accent"
          : "border-dashed border-border text-muted"
      }`}
      role="status"
    >
      {message}
      {state.status === "shared" ? (
        <span className="block text-muted">
          Keep this tab open while others are watching.
        </span>
      ) : null}
    </p>
  );
}

function formatOthers(count: number): string {
  return count === 1 ? "1 other participant" : `${count} other participants`;
}
