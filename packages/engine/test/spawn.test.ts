import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { Game, type Order } from "../src/game.ts";
import { installSpawn } from "../src/spawn.ts";
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
  const starts = installSpawn(game);
  const run = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  return { grid, game, starts, run };
}

const spawn = (tile: number): Order => ({ type: "spawn", tile });

describe("spawn phase", () => {
  it("gives a player the tiles around their start and their first troops (R-SPAWN-04)", () => {
    const { grid, game, starts, run } = newGame();
    const tile = grid.index(5, 5);
    expect(run([{ player: 1, order: spawn(tile) }])).toBe(1);

    expect(starts.get(1)).toBe(tile);
    expect(game.territory.tileCount(1)).toBe(5);
    for (const t of grid.tilesWithin(tile, 1)) expect(game.territory.ownerOf(t)).toBe(1);
    expect(game.player(1)?.troops).toBe(500);
  });

  it("moves the start when the player picks again (R-SPAWN-01)", () => {
    const { grid, game, starts, run } = newGame();
    run([{ player: 1, order: spawn(grid.index(5, 5)) }]);
    run([{ player: 1, order: spawn(grid.index(12, 5)) }]);

    expect(starts.get(1)).toBe(grid.index(12, 5));
    expect(game.territory.ownerOf(grid.index(5, 5))).toBe(NEUTRAL);
    expect(game.territory.tileCount(1)).toBe(5);
  });

  it("keeps starts apart and off water (R-SPAWN-02)", () => {
    const kinds = new Uint8Array(200).fill(TileKind.Plains);
    kinds[0] = TileKind.Water;
    const { grid, starts, run } = newGame(20, 10, kinds);
    run([
      { player: 1, order: spawn(grid.index(5, 5)) },
      { player: 2, order: spawn(grid.index(8, 5)) },
      { player: 2, order: spawn(0) },
    ]);
    expect(starts.has(2)).toBe(false);

    run([{ player: 2, order: spawn(grid.index(11, 5)) }]);
    expect(starts.get(2)).toBe(grid.index(11, 5));
  });

  it("measures spacing across the east-west seam", () => {
    const { grid, starts, run } = newGame();
    run([
      { player: 1, order: spawn(grid.index(0, 5)) },
      { player: 2, order: spawn(grid.index(17, 5)) },
    ]);
    expect(starts.has(2)).toBe(false);
  });

  it("places players who did not pick, at the same tile on every run (R-SPAWN-03)", () => {
    const outcome = () => {
      const { grid, game, starts, run } = newGame(30, 10, undefined, 4);
      run([{ player: 1, order: spawn(grid.index(3, 3)) }]);
      run();
      expect(starts.size).toBe(1);
      run();
      expect(game.phase).toBe("play");
      return [...starts.entries()].sort((a, b) => a[0] - b[0]);
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
    const { starts, run, game } = newGame(4, 2, undefined, 3);
    run();
    run();
    run();
    expect(starts.size).toBe(3);
    expect(game.players().every((p) => game.territory.tileCount(p.id) > 0)).toBe(true);
  });

  it("leaves a player unplaced when no land is free", () => {
    const kinds = new Uint8Array(8).fill(TileKind.Water);
    kinds[0] = TileKind.Plains;
    const { starts, run } = newGame(4, 2, kinds, 2);
    run();
    run();
    run();
    expect(starts.size).toBe(1);
  });

  it("refuses spawns once the phase is over", () => {
    const { grid, starts, run } = newGame();
    run();
    run();
    run();
    expect(run([{ player: 1, order: spawn(grid.index(15, 2)) }])).toBe(0);
    expect(starts.get(1)).not.toBe(grid.index(15, 2));
  });
});
