import { TileKind } from "@frontfall/engine";
import { describe, expect, it } from "vitest";
import { GENERATED_MAPS, generateMap } from "../src/game/maps.ts";
import { HUMAN_ID, SoloGame, type SoloOptions } from "../src/game/solo-game.ts";

const options: SoloOptions = {
  map: "skirmish",
  seed: 11,
  bots: 3,
  difficulty: "normal",
  playerName: "Ada",
};

function newGame(game: SoloOptions): SoloGame {
  return new SoloGame(game, generateMap(game.map));
}

function firstLand(map: string): number {
  return generateMap(map).kinds.findIndex((kind) => kind !== TileKind.Water);
}

describe("maps", () => {
  it("generates every listed map identically twice", () => {
    for (const { id, width, height } of GENERATED_MAPS) {
      const map = generateMap(id);
      expect(map.kinds).toHaveLength(width * height);
      expect(generateMap(id).kinds).toEqual(map.kinds);
      expect(map.kinds.some((kind) => kind !== TileKind.Water)).toBe(true);
    }
  });

  it("rejects an unknown map", () => {
    expect(() => generateMap("atlantis")).toThrow(RangeError);
  });
});

describe("SoloGame", () => {
  it("places the human where they click and reports the tiles that changed", () => {
    const solo = newGame(options);
    const tile = firstLand(options.map);
    const update = solo.step([{ type: "spawn", tile }]);
    expect(update.phase).toBe("spawn");
    expect(update.players.map((player) => player.name)).toEqual([
      "Ada",
      "Aldmere",
      "Brask",
      "Corvan",
    ]);
    const human = update.players.find((player) => player.id === HUMAN_ID);
    expect(human?.tiles).toBeGreaterThan(0);
    expect(update.changedTiles).toContain(tile);
    const index = update.changedTiles.indexOf(tile);
    expect(update.changedOwners[index]).toBe(HUMAN_ID);
    expect(solo.step([]).changedTiles).toHaveLength(0);
  });

  it("places everyone at the end of the spawn phase and gives the same result twice", () => {
    const run = (): number[] => {
      const solo = newGame(options);
      let update = solo.step([]);
      while (update.phase === "spawn") update = solo.step([]);
      expect(update.spawnTicksLeft).toBe(0);
      return update.players.map((player) => player.tiles);
    };
    const tiles = run();
    expect(tiles.every((count) => count > 0)).toBe(true);
    expect(run()).toEqual(tiles);
  });

  it("plays a whole game against hard bots to a winner, then stops (R-WIN-01)", () => {
    const solo = newGame({ ...options, difficulty: "hard" });
    let update = solo.step([]);
    while (update.winner === undefined && update.tick < 6000) update = solo.step([]);
    expect(update.winner).toBeDefined();
    expect(update.phase).toBe("play");
    expect(solo.step([]).tick).toBe(update.tick);
  }, 60_000);
});

describe("SoloGame attacks", () => {
  it("expands into unowned land after a click once the spawn phase is over", () => {
    const solo = newGame({ ...options, bots: 1 });
    const start = firstLand(options.map);
    let update = solo.step([{ type: "spawn", tile: start }]);
    while (update.phase === "spawn") update = solo.step([]);
    const human = (): number => update.players.find((player) => player.id === HUMAN_ID)?.tiles ?? 0;
    const before = human();
    const { territory, terrain } = solo.game;
    // Any unowned land: the front heads towards it.
    const target = territory.owners.findIndex(
      (owner, tile) => owner === 0 && terrain.isOwnable(tile),
    );
    update = solo.step([{ type: "attack", target, troops: 1000 }]);
    expect(update.attacks).toHaveLength(1);
    for (let i = 0; i < 20; i++) update = solo.step([]);
    expect(human()).toBeGreaterThan(before);
  });
});

describe("SoloGame clicks", () => {
  it("turns a click into the order the phase allows", () => {
    const solo = newGame(options);
    const land = firstLand(options.map);
    expect(solo.orderForClick(land, 30)).toEqual({ type: "spawn", tile: land });
    expect(solo.orderForClick(0, 30)).toBeUndefined();
    expect(solo.orderForClick(-1, 30)).toBeUndefined();

    let update = solo.step([{ type: "spawn", tile: land }]);
    while (update.phase === "spawn") update = solo.step([]);
    const troops = update.players.find((player) => player.id === HUMAN_ID)?.troops ?? 0;
    const { territory, terrain } = solo.game;
    const free = territory.owners.findIndex(
      (owner, tile) => owner === 0 && terrain.isOwnable(tile),
    );
    expect(solo.orderForClick(free, 30)).toEqual({
      type: "attack",
      target: free,
      troops: Math.floor((troops * 30) / 100),
    });
    expect(solo.orderForClick(land, 30)).toBeUndefined();
  });
});
