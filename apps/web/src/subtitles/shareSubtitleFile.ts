import { SHARED_SUBTITLE_MAX_BYTES, utf8ByteLength } from "@swarmcue/protocol";
import { toMediaName } from "../media/mediaName.js";
import type { SubtitleShareRequest } from "../room/roomSession.js";
import type { SubtitleResult } from "./normalizeSubtitle.js";

/** Where a shared subtitle would go: the room's current media. */
export type SubtitleShareTarget = {
  mediaMagnetUri: string;
  /** Changes whenever the room or its media changes. */
  key: string;
};

export type SubtitleSharerDeps = {
  readFile: (file: File) => Promise<SubtitleResult>;
  /** Null when there is nothing to share a subtitle for. */
  currentTarget: () => SubtitleShareTarget | null;
  /** Returns a message when the command cannot be sent, otherwise null. */
  send: (request: SubtitleShareRequest) => string | null;
};

export type ShareOutcome =
  | { status: "sent" }
  | { status: "failed"; message: string }
  /** Superseded by a newer pick, or the room or media changed while reading. */
  | { status: "stale" };

export type SubtitleSharer = {
  share: (file: File) => Promise<ShareOutcome>;
  /** Make any read in flight stale. */
  cancel: () => void;
};

const MESSAGE_TOO_LARGE =
  "Too large to share with the room (512 KB max). You can still add it as your own subtitle.";

export function createSubtitleSharer(deps: SubtitleSharerDeps): SubtitleSharer {
  let requestId = 0;

  return {
    async share(file) {
      const request = ++requestId;
      const target = deps.currentTarget();
      if (!target) {
        return { status: "failed", message: "There is no video to share a subtitle for." };
      }

      let result: SubtitleResult;
      try {
        result = await deps.readFile(file);
      } catch {
        result = {
          ok: false,
          error: { code: "unreadable", message: "The browser could not read this file." },
        };
      }
      if (request !== requestId || deps.currentTarget()?.key !== target.key) {
        return { status: "stale" };
      }
      if (!result.ok) {
        return { status: "failed", message: result.error.message };
      }
      if (utf8ByteLength(result.subtitle.vtt) > SHARED_SUBTITLE_MAX_BYTES) {
        return { status: "failed", message: MESSAGE_TOO_LARGE };
      }

      const error = deps.send({
        name: toMediaName(file.name) ?? "Subtitle",
        content: result.subtitle.vtt,
        mediaMagnetUri: target.mediaMagnetUri,
      });
      return error ? { status: "failed", message: error } : { status: "sent" };
    },

    cancel() {
      requestId += 1;
    },
  };
}
