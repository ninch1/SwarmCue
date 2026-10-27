/**
 * Where cues without their own position are placed: the top of the cue box,
 * as a percentage of the video height (WebVTT `line` with `snapToLines`
 * false). Browsers otherwise put such cues at the very bottom and only lift
 * them while the native controls are visible; a fixed position keeps them
 * steady and clear of the controls.
 */
export const DEFAULT_CUE_LINE_PERCENT = 82;

/**
 * Give every auto-positioned `VTTCue` the default line. Cues with an explicit
 * `line` (e.g. `line:10%` in the file) and non-VTTCue objects are left alone.
 * Safe to call repeatedly: adjusted cues no longer have `line === "auto"`.
 */
export function applyDefaultCueLine(
  cues: TextTrackCueList | null | undefined,
  linePercent: number = DEFAULT_CUE_LINE_PERCENT,
): void {
  if (!cues || typeof VTTCue === "undefined") {
    return;
  }
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (cue instanceof VTTCue && cue.line === "auto") {
      cue.snapToLines = false;
      cue.line = linePercent;
    }
  }
}
