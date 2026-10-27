import { describe, expect, it } from "vitest";
import {
  createSharedMediaMemory,
  SHARED_MEDIA_STORAGE_KEY,
} from "./sharedMediaMemory.js";

const memory = { roomId: "K7QM3XPD", infoHash: "c9e15763f722f23e98a29decdfae341b98d53056" };

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
}

describe("createSharedMediaMemory", () => {
  it("saves and loads the room and info hash", () => {
    const storage = memoryStorage();
    const store = createSharedMediaMemory(storage);

    store.save(memory);

    expect(JSON.parse(storage.items.get(SHARED_MEDIA_STORAGE_KEY) ?? "")).toEqual({
      v: 1,
      ...memory,
    });
    expect(store.load()).toEqual(memory);
  });

  it("clears the record", () => {
    const storage = memoryStorage();
    const store = createSharedMediaMemory(storage);
    store.save(memory);

    store.clear();

    expect(store.load()).toBeNull();
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["an uppercase or short hash", JSON.stringify({ v: 1, ...memory, infoHash: "ABC" })],
    ["a malformed room id", JSON.stringify({ v: 1, ...memory, roomId: "x" })],
    ["extra fields", JSON.stringify({ v: 1, ...memory, name: "movie.mp4" })],
    ["another version", JSON.stringify({ v: 2, ...memory })],
  ])("discards %s", (_label, raw) => {
    const storage = memoryStorage({ [SHARED_MEDIA_STORAGE_KEY]: raw });

    expect(createSharedMediaMemory(storage).load()).toBeNull();
    expect(storage.items.has(SHARED_MEDIA_STORAGE_KEY)).toBe(false);
  });

  it("returns null without storage", () => {
    expect(createSharedMediaMemory(null).load()).toBeNull();
  });
});
