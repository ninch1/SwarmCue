import type { SubtitleResult } from "./normalizeSubtitle.js";

export type PersonalSubtitle = {
  /** New for every successfully loaded file, including the same file picked again. */
  id: number;
  fileName: string;
  /** Object URL of the normalized WebVTT text; kept while another source is shown. */
  url: string;
  cueCount: number;
  skippedBlocks: number;
};

export type PersonalSubtitleState = {
  subtitle: PersonalSubtitle | null;
  /** A picked file is being read. */
  loading: boolean;
  /** The latest pick failed; any previous subtitle stays active. */
  error: { fileName: string; message: string } | null;
};

export type PersonalSubtitlesDeps = {
  readFile: (file: File) => Promise<SubtitleResult>;
  /** Wrap WebVTT text in an object URL a <track> element can load. */
  createObjectUrl: (vtt: string) => string;
  revokeObjectUrl: (url: string) => void;
  onStateChange: (state: PersonalSubtitleState) => void;
};

export type PersonalSubtitles = {
  getState: () => PersonalSubtitleState;
  /** Load a file, replacing the current subtitle only if it is valid. */
  select: (file: File) => Promise<void>;
  remove: () => void;
  /** The media changed: drop the subtitle, its error, and any read in flight. */
  reset: () => void;
  /** Release the object URL; the controller must not be used afterwards. */
  dispose: () => void;
};

export const emptyPersonalSubtitleState: PersonalSubtitleState = {
  subtitle: null,
  loading: false,
  error: null,
};

/**
 * Personal subtitles stay in this browser tab. This controller owns the one
 * object URL of the personal subtitle and revokes it whenever the subtitle is
 * replaced, removed, reset, or disposed (not when another source is shown).
 * It never touches the video or the room; whether it is visible is decided
 * by the subtitle selection.
 */
export function createPersonalSubtitles(deps: PersonalSubtitlesDeps): PersonalSubtitles {
  let state = emptyPersonalSubtitleState;
  let nextId = 1;
  /** Bumped to make a read in flight stale. */
  let requestId = 0;
  let disposed = false;

  function setState(next: PersonalSubtitleState) {
    state = next;
    deps.onStateChange(state);
  }

  function clear() {
    requestId += 1;
    if (state.subtitle) {
      deps.revokeObjectUrl(state.subtitle.url);
    }
    if (state !== emptyPersonalSubtitleState) {
      setState(emptyPersonalSubtitleState);
    }
  }

  return {
    getState: () => state,

    async select(file) {
      if (disposed) {
        return;
      }
      const request = ++requestId;
      setState({ ...state, loading: true, error: null });

      let result: SubtitleResult;
      try {
        result = await deps.readFile(file);
      } catch {
        result = {
          ok: false,
          error: { code: "unreadable", message: "The browser could not read this file." },
        };
      }
      if (disposed || request !== requestId) {
        return;
      }

      if (!result.ok) {
        setState({
          ...state,
          loading: false,
          error: { fileName: file.name, message: result.error.message },
        });
        return;
      }

      const previous = state.subtitle;
      setState({
        subtitle: {
          id: nextId++,
          fileName: file.name,
          url: deps.createObjectUrl(result.subtitle.vtt),
          cueCount: result.subtitle.cueCount,
          skippedBlocks: result.subtitle.skippedBlocks,
        },
        loading: false,
        error: null,
      });
      if (previous) {
        deps.revokeObjectUrl(previous.url);
      }
    },

    remove() {
      if (!disposed) {
        clear();
      }
    },

    reset() {
      if (!disposed) {
        clear();
      }
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      requestId += 1;
      if (state.subtitle) {
        deps.revokeObjectUrl(state.subtitle.url);
      }
    },
  };
}
