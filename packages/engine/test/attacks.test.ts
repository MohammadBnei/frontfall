import { describe, expect, it } from "vitest";
import { installAttacks } from "../src/attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { Game, type Order, type Player } from "../src/game.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = {
  ...DEFAULT_BALANCE,
  spawnPhaseTicks: 0,
  neutralCost: 10,
  reliefCostTenths: [10, 20, 30],
  attackSpeedDivisor: 1000,
  defenseDensityTenths: 10,
};

/** A 10 x 3 cylinder; columns given by the caller are owned by players. */
function newGame(
  owners: Record<number, number[]> = {},
  kinds?: Uint8Array,
  overrides: Partial<Balance> = {},
) {
  const grid = new WorldGrid(10, 3);
  const game = new Game({
    terrain: new Terrain(grid, kinds ?? new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 3,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...balance, ...overrides },
  });
  installAttacks(game);
  const attacks = { list: () => game.attacks };
  for (const [player, columns] of Object.entries(owners)) {
    for (const x of columns) {
      for (let y = 0; y < 3; y++) game.territory.setOwner(grid.index(x, y), Number(player));
    }
  }
  const ada = game.player(1) as Player;
  const bea = game.player(2) as Player;
  const run = (orders: { player: number; order: Order }[] = []) =>
    game.step({ tick: game.tick, orders });
  const attack = (player: number, target: number, troops: number) => ({
    player,
    order: { type: "attack", target, troops } as Order,
  });
  return { grid, game, attacks, ada, bea, run, attack };
}

describe("expansion into unowned land", () => {
  it("takes the tiles closest to the aim first, one per tick at low speed (R-ATTACK-03)", () => {
    const { grid, game, ada, run, attack } = newGame({ 1: [0] });
    ada.troops = 100;
    expect(run([attack(1, grid.index(3, 0), 25)])).toBe(1);
    expect(ada.troops).toBe(75);
    expect(game.territory.ownerOf(grid.index(1, 0))).toBe(1);
    expect(game.territory.tileCount(1)).toBe(4);
  });

  it("pays more for relief and stops when troops run out, returning the rest (R-MAP-06, R-ATTACK-05)", () => {
    const kinds = new Uint8Array(30).fill(TileKind.Plains);
    kinds[1] = TileKind.Mountains;
    const { grid, game, ada, attacks, run, attack } = newGame({ 1: [0] }, kinds);
    ada.troops = 35;
    run([attack(1, grid.index(1, 0), 35)]);
    // The mountain costs 30, leaving 5: not enough for another tile.
    expect(game.territory.ownerOf(1)).toBe(1);
    run();
    expect(attacks.list()).toEqual([]);
    expect(ada.troops).toBe(5);
    expect(game.territory.tileCount(1)).toBe(4);
  });

  it("ends once no reachable tile is left, returning the troops (R-ATTACK-05)", () => {
    const { grid, game, ada, attacks, run, attack } = newGame({ 1: [0] }, undefined, {
      attackSpeedDivisor: 1,
    });
    ada.troops = 1000;
    run([attack(1, grid.index(5, 1), 1000)]);
    for (let i = 0; i < 10; i++) run();
    expect(game.territory.tileCount(1)).toBe(30);
    expect(attacks.list()).toEqual([]);
    expect(ada.troops).toBe(1000 - 27 * 10);
  });

  it("crosses the east-west seam", () => {
    const { grid, game, ada, run, attack } = newGame({ 1: [0] });
    ada.troops = 10;
    run([attack(1, grid.index(9, 1), 10)]);
    expect(game.territory.ownerOf(grid.index(9, 1))).toBe(1);
  });

  it("speeds up with more troops (B-ATTACK-SPEED)", () => {
    const { grid, game, ada, run, attack } = newGame({ 1: [0] }, undefined, {
      attackSpeedDivisor: 5,
    });
    ada.troops = 200;
    // 1 + isqrt(200) / 5 = 3 tiles in the first tick.
    run([attack(1, grid.index(5, 1), 200)]);
    expect(game.territory.tileCount(1)).toBe(3 + 3);
  });

  it("merges a second order into the running attack and follows the new aim", () => {
    const { grid, ada, attacks, run, attack } = newGame({ 1: [0] });
    ada.troops = 100;
    run([attack(1, grid.index(3, 0), 30), attack(1, grid.index(7, 2), 30)]);
    expect(attacks.list()).toHaveLength(1);
    expect(attacks.list()[0]?.aim).toBe(grid.index(7, 2));
    expect(ada.troops).toBe(40);
  });

  it("refuses a target that does not touch the player's land (R-ATTACK-09)", () => {
    const kinds = new Uint8Array(30).fill(TileKind.Plains);
    for (let y = 0; y < 3; y++) {
      kinds[y * 10 + 1] = TileKind.Water;
      kinds[y * 10 + 9] = TileKind.Water;
    }
    const { grid, ada, run, attack } = newGame({ 1: [0] }, kinds);
    ada.troops = 100;
    expect(run([attack(1, grid.index(5, 1), 50)])).toBe(0);
    expect(ada.troops).toBe(100);
  });
});

describe("attacks between players", () => {
  it("costs more against a dense defender, who loses troops with each tile (R-ATTACK-03)", () => {
    const { grid, game, ada, bea, run, attack } = newGame({ 1: [0, 1], 2: [2, 3] });
    ada.troops = 1000;
    bea.troops = 60;
    // Bea holds 6 tiles with 60 troops: 10 per tile, so a tile costs 10 + 10.
    run([attack(1, grid.index(2, 1), 100)]);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(1);
    expect(bea.troops).toBe(50);
    expect(game.territory.tileCount(2)).toBe(5);
  });

  it("refuses to attack an eliminated player", () => {
    const { grid, ada, bea, run, attack } = newGame({ 1: [0], 2: [1] });
    ada.troops = 100;
    bea.alive = false;
    expect(run([attack(1, grid.index(1, 0), 50)])).toBe(0);
  });

  it("makes opposite attacks fight before any tile changes hands (R-ATTACK-07)", () => {
    const { grid, game, ada, bea, attacks, run, attack } = newGame({ 1: [0, 1], 2: [2, 3] });
    ada.troops = 100;
    bea.troops = 100;
    run([attack(1, grid.index(2, 0), 80), attack(2, grid.index(1, 0), 30)]);
    // 30 troops on each side cancel out; Ada's remaining 50 take one tile at 10 + 70 / 6.
    expect(attacks.list().map((a) => [a.player, a.troops])).toEqual([[1, 29]]);
    expect(game.territory.tileCount(1)).toBe(7);
    expect([ada.troops, bea.troops]).toEqual([20, 59]);
  });

  it("loses the troops of an attack whose player was eliminated", () => {
    const { grid, game, ada, attacks, run, attack } = newGame({ 1: [0] });
    ada.troops = 100;
    run([attack(1, grid.index(5, 0), 100)]);
    ada.alive = false;
    run();
    expect(attacks.list()).toEqual([]);
    expect(game.territory.ownerOf(grid.index(5, 0))).toBe(NEUTRAL);
  });
});

describe("encirclement", () => {
  /** Columns 0-4 of a 10 x 3 flat strip: Ada around a pocket of Bea. */
  function pocketGame(pocketOwner: number, extra: Record<number, number[]> = {}) {
    const built = newGame({ 1: [0, 1, 2, 3, 4], ...extra });
    const { grid, game } = built;
    game.territory.setOwner(grid.index(2, 1), pocketOwner);
    game.territory.setOwner(grid.index(3, 1), pocketOwner);
    game.territory.setOwner(grid.index(4, 1), 2);
    game.territory.setOwner(grid.index(5, 1), 2);
    return built;
  }

  it("captures the defender's land left enclosed by the attacker (R-ATTACK-08)", () => {
    const { grid, game, ada, bea, run, attack } = pocketGame(2);
    ada.troops = 1000;
    bea.troops = 10;
    // Taking (4, 1) cuts (2-3, 1) off from the rest of Bea's land at (5, 1).
    run([attack(1, grid.index(4, 1), 100)]);
    expect(game.territory.ownerOf(grid.index(4, 1))).toBe(1);
    expect(game.territory.ownerOf(grid.index(5, 1))).toBe(2);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(1);
    expect(game.territory.ownerOf(grid.index(3, 1))).toBe(1);
  });

  it("leaves a pocket that still touches a third party", () => {
    const { grid, game, ada, run, attack } = pocketGame(2);
    game.territory.setOwner(grid.index(2, 0), NEUTRAL);
    ada.troops = 1000;
    run([attack(1, grid.index(4, 1), 100)]);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(2);
  });

  it("leaves pockets larger than the limit (B-ENCIRCLE-MAX)", () => {
    const built = newGame({ 1: [0, 1, 2, 3, 4] }, undefined, { encircleMaxTiles: 1 });
    const { grid, game, ada, run, attack } = built;
    game.territory.setOwner(grid.index(2, 1), 2);
    game.territory.setOwner(grid.index(3, 1), 2);
    game.territory.setOwner(grid.index(4, 1), 2);
    game.territory.setOwner(grid.index(5, 1), 2);
    ada.troops = 1000;
    run([attack(1, grid.index(4, 1), 100)]);
    expect(game.territory.ownerOf(grid.index(2, 1))).toBe(2);
  });
});

describe("retreat", () => {
  it("calls an attack back, returning its troops minus the penalty (R-ATTACK-06)", () => {
    const { grid, game, ada, attacks, run, attack } = newGame({ 1: [0] });
    ada.troops = 500;
    run([attack(1, grid.index(5, 1), 400)]);
    const running = attacks.list()[0];
    if (!running) throw new Error("attack missing");
    const left = running.troops;
    const tiles = game.territory.tileCount(1);

    expect(run([{ player: 1, order: { type: "retreat", attack: running.id } }])).toBe(1);
    expect(attacks.list()).toEqual([]);
    expect(ada.troops).toBe(100 + left - Math.floor((left * 25) / 100));
    expect(game.territory.tileCount(1)).toBe(tiles);
  });

  it("only lets a player call back their own attacks", () => {
    const { grid, ada, bea, attacks, run, attack } = newGame({ 1: [0], 2: [5] });
    ada.troops = 500;
    bea.troops = 500;
    run([attack(1, grid.index(3, 1), 400)]);
    const id = attacks.list()[0]?.id ?? 0;
    expect(run([{ player: 2, order: { type: "retreat", attack: id } }])).toBe(0);
    expect(run([{ player: 1, order: { type: "retreat", attack: id + 7 } }])).toBe(0);
    expect(attacks.list()).toHaveLength(1);
  });
});
