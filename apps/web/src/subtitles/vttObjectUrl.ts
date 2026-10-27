/** Wrap WebVTT text in an object URL a <track> element can load. Revoke it when done. */
export function vttObjectUrl(vtt: string): string {
  return URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
}
