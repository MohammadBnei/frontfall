import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import { installEconomy, OPERATOR_GOLD_FACTOR } from "../src/economy.ts";
import { Game, type Player } from "../src/game.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

function newGame(goldBonus?: number) {
  const grid = new WorldGrid(10, 10);
  const game = new Game({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 1,
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bea" },
    ],
    balance: { ...DEFAULT_BALANCE, spawnPhaseTicks: 0 },
    ...(goldBonus === undefined ? {} : { goldBonus }),
  });
  installEconomy(game);
  for (let tile = 0; tile < 10; tile++) game.territory.setOwner(tile, 1);
  for (let tile = 10; tile < 20; tile++) game.territory.setOwner(tile, 2);
  for (const id of [1, 2]) (game.player(id) as Player).troops = 5000;
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) game.step({ tick: game.tick, orders: [] });
  };
  return { game, run };
}

describe("operator's gold bonus (R-MODE-09)", () => {
  it("doubles the income of its player only", () => {
    const plain = newGame();
    const bonus = newGame(1);
    plain.run(100);
    bonus.run(100);
    const gold = (game: Game, id: number) => (game.player(id) as Player).gold;
    expect(gold(plain.game, 1)).toBeGreaterThan(0);
    // Troops grow the same in both games, so only the factor differs.
    expect(gold(bonus.game, 1)).toBeGreaterThanOrEqual(
      OPERATOR_GOLD_FACTOR * gold(plain.game, 1) - 1,
    );
    expect(gold(bonus.game, 1)).toBeLessThanOrEqual(OPERATOR_GOLD_FACTOR * gold(plain.game, 1) + 1);
    expect(gold(bonus.game, 2)).toBe(gold(plain.game, 2));
  });

  it("leaves the hash and setup digest of games without it as they were", () => {
    const none = newGame();
    const zero = newGame(0);
    expect(zero.game.hash()).toBe(none.game.hash());
    expect(zero.game.setupDigest()).toBe(none.game.setupDigest());
    const bonus = newGame(1);
    expect(bonus.game.hash()).not.toBe(none.game.hash());
    expect(bonus.game.setupDigest()).not.toBe(none.game.setupDigest());
  });

  it("refuses a player the game does not have", () => {
    expect(() => newGame(3)).toThrow(RangeError);
  });
});
