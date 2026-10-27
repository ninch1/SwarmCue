# SwarmCue TODO

## Reminders

- [ ] Add rate limiting for client WebSocket messages (architecture: reject excessive client messages). The rooms milestone only enforces a 4 KB `maxPayload` and schema validation. Include `playback.set`, since any participant can send it and each change is broadcast to the room, and `clock.ping`, which any connection may send even before joining a room, and `room.resume`, which any connection may send to guess a session (tokens are 256-bit, so guessing is impractical, but repeated attempts should still be throttled).
- [ ] Before the first deployment, measure web bundle size and load time, and consider lazy-loading WebTorrent (dynamic `import()` of `apps/web/src/torrent/client.ts`). The single JS chunk is ~549 KB minified (~167 KB gzipped), over Vite's 500 KB warning: React ~227 KB, WebTorrent ~230 KB, Zod and room code ~90 KB.
- [ ] Revisit the torrent cache-cleanup policy if a media queue is ever added after V1. Deleting torrent data as soon as media changes fits V1's single current media item, but with a queue it would mean previously queued media must download again, the peer stops helping seed older items, and returning to a previous item is slower.

## Testing

- [ ] Thoroughly test torrent cache cleanup (`apps/web/src/torrent/storage.ts`, `destroyStoreOnDestroy` in `apps/web/src/torrent/client.ts`). Inspect OPFS via DevTools → Application → Storage, or list entries with `for await (const k of (await navigator.storage.getDirectory()).keys()) console.log(k)`.
  - [ ] Switching media deletes the previous torrent's folder (the host switches files, and viewers switch when the host changes media).
  - [ ] The same media loaded twice in a row in one tab works (regression check for waiting on WebTorrent's removal callback).
  - [ ] Refresh while seeding: leftover folder is removed on the next load.
  - [ ] Refresh while streaming shared media: leftover folder is removed on the next load.
  - [ ] Closing the tab, then reopening the app: leftovers are removed.
  - [ ] Two SwarmCue tabs open: a refresh in one tab must not delete the other tab's active seeding/streaming data.
  - [ ] Picking a file, or receiving shared media, right after load waits for the sweep and still works.
  - [ ] Large file (multi-GB): storage usage drops back after switching or refreshing.
  - [ ] Browsers: Chrome, Firefox, Safari (Safari OPFS/Web Locks support and the memory-store fallback).
