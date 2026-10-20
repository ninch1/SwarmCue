# SwarmCue TODO

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
