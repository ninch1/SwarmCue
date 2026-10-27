import { describe, expect, it, vi } from "vitest";
import { createSessionStore, SESSION_STORAGE_KEY } from "./sessionStore.js";

const session = {
  roomId: "K7QM3XPD",
  resumeToken: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE",
};

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

describe("createSessionStore", () => {
  it("saves only the room id and token, and loads them back", () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage);

    store.save(session);

    expect(JSON.parse(storage.items.get(SESSION_STORAGE_KEY) ?? "")).toEqual({
      v: 1,
      ...session,
    });
    expect(store.load()).toEqual(session);
  });

  it("returns null when nothing is stored", () => {
    expect(createSessionStore(memoryStorage()).load()).toBeNull();
  });

  it("clears the stored session", () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage);
    store.save(session);

    store.clear();

    expect(storage.items.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(store.load()).toBeNull();
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["a different format version", JSON.stringify({ v: 2, ...session })],
    ["a malformed token", JSON.stringify({ v: 1, ...session, resumeToken: "short" })],
    ["a malformed room id", JSON.stringify({ v: 1, ...session, roomId: "nope" })],
    ["extra fields", JSON.stringify({ v: 1, ...session, participantId: "p1" })],
    ["a non-object", JSON.stringify("hello")],
  ])("discards %s", (_label, raw) => {
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: raw });

    expect(createSessionStore(storage).load()).toBeNull();
    expect(storage.items.has(SESSION_STORAGE_KEY)).toBe(false);
  });

  it("keeps working when storage is unavailable or throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };

    expect(createSessionStore(null).load()).toBeNull();
    const store = createSessionStore(throwing);
    expect(() => store.save(session)).not.toThrow();
    expect(store.load()).toBeNull();
    expect(() => store.clear()).not.toThrow();
    error.mockRestore();
  });
});
