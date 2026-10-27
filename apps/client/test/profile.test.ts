import { describe, expect, it } from "vitest";
import {
  MAX_RECENT,
  emptyProfile,
  forgetProfile,
  loadProfile,
  sanitizeProfile,
  saveProfile,
  withGame,
  type RecentGame,
} from "../src/ui/profile.ts";

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const throwing = {
  getItem(): never {
    throw new Error("SecurityError");
  },
  setItem(): never {
    throw new Error("QuotaExceededError");
  },
  removeItem(): never {
    throw new Error("SecurityError");
  },
} as unknown as Storage;

const game = (at: number): RecentGame => ({
  at,
  map: "world",
  mode: "solo",
  outcome: "victory",
  minutes: 12.4,
});

describe("local profile", () => {
  it("starts empty, with the usual colour", () => {
    expect(loadProfile(new MemoryStorage() as unknown as Storage)).toEqual(emptyProfile());
    expect(loadProfile(undefined)).toEqual(emptyProfile());
  });

  it("remembers the colour and the last games, newest first, up to ten", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    let profile = { ...emptyProfile(), color: 3 };
    for (let at = 1; at <= MAX_RECENT + 2; at++) profile = withGame(profile, game(at));
    saveProfile(profile, storage);
    const loaded = loadProfile(storage);
    expect(loaded.color).toBe(3);
    expect(loaded.games).toHaveLength(MAX_RECENT);
    expect(loaded.games[0]?.at).toBe(MAX_RECENT + 2);
    // Minutes are kept whole.
    expect(loaded.games[0]?.minutes).toBe(12);
  });

  it("drops anything that does not make sense", () => {
    expect(sanitizeProfile("nope")).toEqual(emptyProfile());
    const profile = sanitizeProfile({
      color: 99,
      games: [game(1), { ...game(2), outcome: "won" }, { ...game(3), map: "" }, null, 7],
    });
    expect(profile.color).toBe(0);
    expect(profile.games.map((entry) => entry.at)).toEqual([1]);
  });

  it("copes with corrupted or unavailable storage", () => {
    const storage = new MemoryStorage();
    storage.setItem("frontfall.profile", "{not json");
    expect(loadProfile(storage as unknown as Storage)).toEqual(emptyProfile());
    // Another version of the format counts as no profile.
    storage.setItem("frontfall.profile", JSON.stringify({ v: 2, color: 3, games: [] }));
    expect(loadProfile(storage as unknown as Storage)).toEqual(emptyProfile());
    expect(loadProfile(throwing)).toEqual(emptyProfile());
    expect(() => {
      saveProfile(emptyProfile(), throwing);
    }).not.toThrow();
    expect(() => {
      forgetProfile(throwing);
    }).not.toThrow();
  });

  it("forgets everything it kept", () => {
    const storage = new MemoryStorage();
    saveProfile(withGame(emptyProfile(), game(1)), storage as unknown as Storage);
    forgetProfile(storage as unknown as Storage);
    expect(storage.items.size).toBe(0);
  });
});
