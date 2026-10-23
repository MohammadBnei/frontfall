import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { Game, type Order } from "../src/game.ts";
import { installSpawn, spawnSettings } from "../src/spawn.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  spawnPhaseTicks: 3,
  spawnDistance: 6,
  spawnRadius: 1,
  startTroops: 500,
};

function newGame(width = 20, height = 10, kinds?: Uint8Array, players = 2, seed = 5) {
  const grid = new WorldGrid(width, height);
  const game = new Game({
    terrain: new Terrain(grid, kinds ?? new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed,
    players: Array.from({ length: players }, (_, i) => ({ id: i + 1, name: `P${String(i + 1)}` })),
    balance,
  });
  installSpawn(game);
  const starts = new Map<number, number>();
  const placed = () => {
    starts.clear();
    for (const player of game.players()) {
      if (player.start !== undefined) starts.set(player.id, player.start);
    }
    return starts;
  };
  const run = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  return { grid, game, placed, run };
}

const spawn = (tile: number): Order => ({ type: "spawn", tile });

describe("spawn phase", () => {
  it("gives a player the tiles around their start and their first troops (R-SPAWN-04)", () => {
    const { grid, game, placed, run } = newGame();
    const tile = grid.index(5, 5);
    expect(run([{ player: 1, order: spawn(tile) }])).toBe(1);

    expect(placed().get(1)).toBe(tile);
    expect(game.territory.tileCount(1)).toBe(5);
    for (const t of grid.tilesWithin(tile, 1)) expect(game.territory.ownerOf(t)).toBe(1);
    expect(game.player(1)?.troops).toBe(500);
  });

  it("moves the start when the player picks again (R-SPAWN-01)", () => {
    const { grid, game, placed, run } = newGame();
    run([{ player: 1, order: spawn(grid.index(5, 5)) }]);
    run([{ player: 1, order: spawn(grid.index(12, 5)) }]);

    expect(placed().get(1)).toBe(grid.index(12, 5));
    expect(game.territory.ownerOf(grid.index(5, 5))).toBe(NEUTRAL);
    expect(game.territory.tileCount(1)).toBe(5);
  });

  it("keeps starts apart and off water (R-SPAWN-02)", () => {
    const kinds = new Uint8Array(200).fill(TileKind.Plains);
    kinds[0] = TileKind.Water;
    const { grid, placed, run } = newGame(20, 10, kinds);
    run([
      { player: 1, order: spawn(grid.index(5, 5)) },
      { player: 2, order: spawn(grid.index(8, 5)) },
      { player: 2, order: spawn(0) },
    ]);
    expect(placed().has(2)).toBe(false);

    run([{ player: 2, order: spawn(grid.index(11, 5)) }]);
    expect(placed().get(2)).toBe(grid.index(11, 5));
  });

  it("measures spacing across the east-west seam", () => {
    const { grid, placed, run } = newGame();
    run([
      { player: 1, order: spawn(grid.index(0, 5)) },
      { player: 2, order: spawn(grid.index(17, 5)) },
    ]);
    expect(placed().has(2)).toBe(false);
  });

  it("places players who did not pick, at the same tile on every run (R-SPAWN-03)", () => {
    const outcome = () => {
      const { grid, game, placed, run } = newGame(30, 10, undefined, 4);
      run([{ player: 1, order: spawn(grid.index(3, 3)) }]);
      run();
      expect(placed().size).toBe(1);
      run();
      expect(game.phase).toBe("play");
      return [...placed().entries()].sort((a, b) => a[0] - b[0]);
    };
    const first = outcome();
    expect(first).toHaveLength(4);
    expect(first).toEqual(outcome());
    const grid = new WorldGrid(30, 10);
    for (const [, a] of first) {
      for (const [, b] of first) if (a !== b) expect(grid.distance(a, b)).toBeGreaterThanOrEqual(6);
    }
  });

  it("relaxes spacing rather than leave a player out on a crowded map", () => {
    const { placed, run, game } = newGame(4, 2, undefined, 3);
    run();
    run();
    run();
    expect(placed().size).toBe(3);
    expect(game.players().every((p) => game.territory.tileCount(p.id) > 0)).toBe(true);
  });

  it("leaves a player unplaced when no land is free", () => {
    const kinds = new Uint8Array(8).fill(TileKind.Water);
    kinds[0] = TileKind.Plains;
    const { placed, run } = newGame(4, 2, kinds, 2);
    run();
    run();
    run();
    expect(placed().size).toBe(1);
  });

  it("refuses spawns once the phase is over", () => {
    const { grid, placed, run } = newGame();
    run();
    run();
    run();
    expect(run([{ player: 1, order: spawn(grid.index(15, 2)) }])).toBe(0);
    expect(placed().get(1)).not.toBe(grid.index(15, 2));
  });
});

describe("spawn values on maps of every size (R-SPAWN-06)", () => {
  const settings = (width: number, height: number) =>
    spawnSettings(
      new Game({
        terrain: new Terrain(new WorldGrid(width, height), new Uint8Array(width * height)),
        seed: 1,
        players: [],
      }),
    );

  it("keeps the balance values up to the reference size", () => {
    expect(settings(64, 32)).toEqual({ radius: 3, distance: 30, troops: 2500 });
    expect(settings(1024, 512)).toEqual({ radius: 3, distance: 30, troops: 2500 });
  });

  it("grows them on larger maps, troops with the start area", () => {
    expect(settings(2048, 1024)).toEqual({ radius: 6, distance: 60, troops: 10_000 });
  });
});
