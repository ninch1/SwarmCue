/** Which subtitle this participant sees. Local only; never sent to the room. */
export type SubtitleSource = "off" | "shared" | "personal";

export type SubtitleSelection = {
  active: SubtitleSource;
  /** The user chose "off"; a new room subtitle then stays off for them. */
  userTurnedOff: boolean;
  /**
   * The most recent source that was shown. While off, its track stays
   * attached (hidden) so the browser's captions menu can turn it back on.
   */
  last: "shared" | "personal" | null;
};

export type SubtitleSelectionEvent =
  /** The user picked a source. */
  | { type: "select"; source: SubtitleSource }
  /** A personal subtitle was added or replaced. */
  | { type: "personalLoaded" }
  | { type: "personalRemoved" }
  /** A new room subtitle can be shown. */
  | { type: "sharedArrived" }
  /** The room subtitle is gone (removed, replaced and not yet loaded, or not for this video). */
  | { type: "sharedRemoved" }
  /** This participant shared a subtitle; show it to them. */
  | { type: "sharing" }
  /** The media changed: start over. */
  | { type: "reset" };

export const initialSubtitleSelection: SubtitleSelection = {
  active: "off",
  userTurnedOff: false,
  last: null,
};

/**
 * - Picking a personal file shows it; removing it turns subtitles off rather
 *   than switching to the room subtitle, which may be in another language.
 * - A new room subtitle turns on by itself only for someone who is neither
 *   using their own subtitle nor deliberately turned subtitles off.
 * - Removing the room subtitle never touches the personal one.
 */
export function subtitleSelectionReducer(
  selection: SubtitleSelection,
  event: SubtitleSelectionEvent,
): SubtitleSelection {
  switch (event.type) {
    case "select":
      return {
        active: event.source,
        userTurnedOff: event.source === "off",
        last: event.source === "off" ? selection.last : event.source,
      };
    case "personalLoaded":
      return { active: "personal", userTurnedOff: false, last: "personal" };
    case "personalRemoved":
      return {
        ...selection,
        active: selection.active === "personal" ? "off" : selection.active,
        last: selection.last === "personal" ? null : selection.last,
      };
    case "sharedArrived":
      if (selection.active === "off" && !selection.userTurnedOff) {
        return { ...selection, active: "shared", last: "shared" };
      }
      return selection;
    case "sharedRemoved":
      return {
        ...selection,
        active: selection.active === "shared" ? "off" : selection.active,
        last: selection.last === "shared" ? null : selection.last,
      };
    case "sharing":
      return { active: "shared", userTurnedOff: false, last: "shared" };
    case "reset":
      return initialSubtitleSelection;
  }
}
