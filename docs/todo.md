# SwarmCue TODO

## Next

- [ ] Fix magnets for torrents that contain other files besides the video (subtitles, posters, samples). Viewers get `MEDIA_ELEMENT_ERROR: Format error` (seen with the Cosmos Laundromat demo torrent). Already ruled out in WebTorrent 3.0.21: `pickVideoFile` picks the right file, the stream URL matches nested paths (`lib/server.js`), and the response sets the correct type and supports range requests. Remaining suspects: the browser chunk store (`fsa-chunk-store`) reading pieces that cross file boundaries, and every file in the torrent being downloaded. First step: reproduce in one tab of a clean browser profile with DevTools open, and check the `/webtorrent/...` network request to see whether the response failed or returned bad bytes. Downloading only the chosen video (`file.select()` / `file.deselect()`) is worth doing regardless, since it saves bandwidth.
## Reminders

- [ ] Add rate limiting for client WebSocket messages (architecture: reject excessive client messages). The rooms milestone only enforces a 4 KB `maxPayload` and schema validation.
- [ ] Before the first deployment, measure web bundle size and load time, and consider lazy-loading WebTorrent (dynamic `import()` of `apps/web/src/torrent/client.ts`). The single JS chunk is ~549 KB minified (~167 KB gzipped), over Vite's 500 KB warning: React ~227 KB, WebTorrent ~230 KB, Zod and room code ~90 KB.
- [ ] Revisit the torrent cache-cleanup policy when queue semantics are designed. Deleting torrent data as soon as media changes is a temporary policy: with a queue it would mean previously queued media must download again, the peer stops helping seed older queued items, and returning to a previous item is slower.

## Testing

- [ ] Thoroughly test torrent cache cleanup (`apps/web/src/torrent/storage.ts`, `destroyStoreOnDestroy` in `apps/web/src/torrent/client.ts`). Inspect OPFS via DevTools → Application → Storage, or list entries with `for await (const k of (await navigator.storage.getDirectory()).keys()) console.log(k)`.
  - [ ] Switching media deletes the previous torrent's folder (file → file, file → magnet, magnet → magnet, magnet → file).
  - [ ] Refresh while seeding: leftover folder is removed on the next load.
  - [ ] Refresh while streaming a magnet: leftover folder is removed on the next load.
  - [ ] Closing the tab, then reopening the app: leftovers are removed.
  - [ ] Two SwarmCue tabs open: a refresh in one tab must not delete the other tab's active seeding/streaming data.
  - [ ] Picking a file or pasting a magnet right after load waits for the sweep and still works.
  - [ ] Large file (multi-GB): storage usage drops back after switching or refreshing.
  - [ ] Browsers: Chrome, Firefox, Safari (Safari OPFS/Web Locks support and the memory-store fallback).
