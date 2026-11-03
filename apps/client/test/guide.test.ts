import { describe, expect, it } from "vitest";
import { advance, BASES, CHAPTERS, FIRST_STEPS, STEPS, type GuideState } from "../src/ui/guide.ts";
import { guideDone, setGuideDone } from "../src/ui/guide-state.ts";

const spawn: GuideState = {
  phase: "spawn",
  tiles: 0,
  tilesAtPlay: 0,
  cities: 0,
  ports: 0,
  forts: 0,
  doctrine: "open",
  ratioMoved: false,
  workMoved: false,
  cityStates: true,
  cityStateAttacked: false,
  attacked: false,
  asked: false,
  gold: 0,
};

describe("advance", () => {
  it("waits on each step until the player does it", () => {
    expect(advance("start", spawn)).toBe("start");
    const started = { ...spawn, tiles: 20 };
    // The doctrine is picked on the cards, while the countdown runs.
    expect(advance("start", started)).toBe("doctrine");
    const picked = { ...started, doctrine: "picked" } as const;
    expect(advance("doctrine", picked)).toBe("expand");
    // Growing during the spawn phase is not expanding.
    expect(advance("expand", { ...picked, tiles: 25 })).toBe("expand");
    const playing = { ...picked, phase: "play" as const, tilesAtPlay: 20 };
    expect(advance("expand", playing)).toBe("expand");
    const grown = { ...playing, tiles: 30 };
    expect(advance("expand", grown)).toBe("troops");
    // The slider is a thing the player may leave: Next, or a building, moves on.
    expect(advance("troops", grown, BASES)).toBe("troops");
    expect(advance("troops", { ...grown, ratioMoved: true }, BASES)).toBe("build");
    const worked = { ...grown, ratioMoved: true };
    expect(advance("build", worked, BASES)).toBe("build");
    expect(advance("build", { ...worked, cities: 1 }, BASES)).toBe("attack");
    expect(advance("attack", { ...worked, cities: 1, attacked: true }, BASES)).toBe("port");
    expect(advance("port", { ...worked, cities: 1, attacked: true, ports: 1 }, BASES)).toBe(
      "defend",
    );
    // The last step stays until the player presses Next.
    expect(advance("defend", { ...worked, cities: 1, ports: 1, forts: 1 }, BASES)).toBe("defend");
  });

  it("keeps each chapter's steps waiting for what the player does, whatever they built", () => {
    const built = {
      ...spawn,
      phase: "play",
      tiles: 90,
      tilesAtPlay: 20,
      doctrine: "picked",
      cities: 1,
      ports: 1,
      forts: 1,
    } as const;
    expect(advance("work", built, CHAPTERS.economy)).toBe("work");
    expect(advance("work", { ...built, workMoved: true }, CHAPTERS.economy)).toBe("citystates");
    expect(advance("players", built, CHAPTERS.allies)).toBe("players");
    expect(advance("players", { ...built, asked: true }, CHAPTERS.allies)).toBe("diplomacy");
  });

  it("holds the steps the player only reads until they press Next", () => {
    const everything = {
      ...spawn,
      phase: "play",
      tiles: 90,
      tilesAtPlay: 20,
      doctrine: "picked",
      cities: 1,
      ports: 1,
      forts: 1,
      asked: true,
    } as const;
    for (const step of ["diplomacy", "missiles", "win"] as const) {
      expect(advance(step, everything)).toBe(step);
    }
  });

  it("skips steps the player already did, or that this game has no use for", () => {
    const ahead = {
      ...spawn,
      phase: "play",
      tiles: 40,
      tilesAtPlay: 20,
      doctrine: "picked",
      cities: 1,
      forts: 1,
    } as const;
    // The port is the first thing left to do: the city and the fort were built, which skips the attack.
    expect(advance("start", ahead, BASES)).toBe("port");
    // No doctrines, no city-states: nothing to ask.
    const plain = { ...spawn, tiles: 20, doctrine: "none", cityStates: false } as const;
    expect(advance("start", plain, BASES)).toBe("expand");
    const grown = {
      ...plain,
      phase: "play",
      tilesAtPlay: 20,
      tiles: 40,
      ratioMoved: true,
    } as const;
    expect(advance("expand", grown, BASES)).toBe("build");
  });

  it("covers every step in the core and the chapters, each once", () => {
    const all = [...BASES, ...Object.values(CHAPTERS).flat()];
    expect([...all].sort()).toEqual([...STEPS].sort());
  });

  it("stays on the steps a first game shows, in their own order", () => {
    expect(FIRST_STEPS.every((step) => STEPS.includes(step))).toBe(true);
    expect(FIRST_STEPS.at(-1)).toBe("win");
    const started = { ...spawn, tiles: 20, doctrine: "picked" } as const;
    const playing = { ...started, phase: "play", tilesAtPlay: 20, tiles: 30 } as const;
    expect(advance("expand", { ...playing, ratioMoved: true }, FIRST_STEPS)).toBe("build");
    expect(advance("build", { ...playing, cities: 1 }, FIRST_STEPS)).toBe("defend");
    expect(advance("defend", { ...playing, cities: 1, forts: 1 }, FIRST_STEPS)).toBe("players");
    expect(advance("players", { ...playing, cities: 1, forts: 1, asked: true }, FIRST_STEPS)).toBe(
      "win",
    );
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

describe("play hint storage", () => {
  it("is remembered once seen, and survives storage that throws", async () => {
    const { hintSeen, setHintSeen } = await import("../src/ui/hint-state.ts");
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as unknown as Storage;
    expect(hintSeen(storage)).toBe(false);
    setHintSeen(storage);
    expect(hintSeen(storage)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(hintSeen(undefined)).toBe(false);
    expect(hintSeen(broken)).toBe(false);
    expect(() => {
      setHintSeen(broken);
    }).not.toThrow();
  });
});
