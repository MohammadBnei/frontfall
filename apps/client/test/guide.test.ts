import { describe, expect, it } from "vitest";
import { advance, type GuideState } from "../src/ui/guide.ts";
import { guideDone, setGuideDone } from "../src/ui/guide-state.ts";

const spawn: GuideState = {
  phase: "spawn",
  tiles: 0,
  tilesAtPlay: 0,
  cities: 0,
  forts: 0,
  ports: 0,
  sailed: false,
  collapsed: false,
  playerMenu: false,
};

describe("advance", () => {
  it("waits on each step until the player does it", () => {
    expect(advance("start", spawn)).toBe("start");
    const started = { ...spawn, tiles: 20 };
    expect(advance("start", started)).toBe("expand");
    // Growing during the spawn phase is not expanding.
    expect(advance("expand", { ...started, tiles: 25 })).toBe("expand");
    const playing = { ...started, phase: "play" as const, tilesAtPlay: 20 };
    expect(advance("expand", playing)).toBe("expand");
    expect(advance("expand", { ...playing, tiles: 30 })).toBe("attack");
    // Sending troops cannot be seen: the step waits for Next, or for a building.
    expect(advance("attack", { ...playing, tiles: 30 })).toBe("attack");
    const grown = { ...playing, tiles: 30 };
    expect(advance("attack", { ...grown, cities: 1 })).toBe("sail");
    // A front giving way cannot be asked for: it waits for Next, or one seen, or a building.
    expect(advance("fronts", grown)).toBe("fronts");
    expect(advance("fronts", { ...grown, collapsed: true })).toBe("build");
    expect(advance("build", { ...grown, cities: 1 })).toBe("sail");
    // Not every map has a coast: the ship step waits for Next, a ship, a port or a fort.
    expect(advance("sail", { ...grown, cities: 1 })).toBe("sail");
    expect(advance("sail", { ...grown, cities: 1, sailed: true })).toBe("defend");
    expect(advance("sail", { ...grown, cities: 1, ports: 1 })).toBe("defend");
    expect(advance("defend", { ...grown, cities: 1, forts: 1 })).toBe("players");
    expect(advance("players", { ...playing, playerMenu: true })).toBe("done");
    expect(advance("done", { ...playing, playerMenu: true })).toBe("done");
  });

  it("skips steps the player already did", () => {
    const ahead = {
      phase: "play",
      tiles: 40,
      tilesAtPlay: 20,
      cities: 1,
      forts: 1,
      ports: 0,
      sailed: false,
      collapsed: false,
      playerMenu: false,
    } as const;
    expect(advance("start", ahead)).toBe("players");
  });
});

describe("guide storage", () => {
  it("remembers the guide is done, and forgets it to show it again", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as unknown as Storage;
    expect(guideDone(storage)).toBe(false);
    setGuideDone(storage, true);
    expect(guideDone(storage)).toBe(true);
    setGuideDone(storage, false);
    expect(guideDone(storage)).toBe(false);
  });

  it("works without storage, or with storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(guideDone(undefined)).toBe(false);
    expect(guideDone(broken)).toBe(false);
    expect(() => {
      setGuideDone(broken, true);
    }).not.toThrow();
  });
});
