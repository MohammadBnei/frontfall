import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { createGame } from "../src/create-game.ts";
import { Game, type Order, type Player } from "../src/game.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { installVictory } from "../src/victory.ts";
import { WorldGrid } from "../src/world-grid.ts";

const grid = new WorldGrid(10, 10);
const plains = () => new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains));
const balance: Balance = { ...DEFAULT_BALANCE, spawnPhaseTicks: 0, winSharePercent: 50 };

function newGame(players = 2, overrides: Partial<Balance> = {}) {
  const game = new Game({
    terrain: plains(),
    seed: 1,
    players: Array.from({ length: players }, (_, i) => ({ id: i + 1, name: `P${String(i)}` })),
    balance: { ...balance, ...overrides },
  });
  const victory = installVictory(game);
  const run = () => game.step({ tick: game.tick, orders: [] });
  return { game, victory, run };
}

describe("victory", () => {
  it("goes to the player holding the winning share of land (R-WIN-01)", () => {
    const { game, victory, run } = newGame();
    for (let tile = 0; tile < 49; tile++) game.territory.setOwner(tile, 2);
    run();
    expect(victory.winner()).toBeUndefined();
    game.territory.setOwner(49, 2);
    run();
    expect([victory.winner(), victory.decidedAt()]).toEqual([2, 1]);
  });

  it("goes to the last player standing, and never changes afterwards (R-WIN-01)", () => {
    const { game, victory, run } = newGame(3);
    game.territory.setOwner(0, 3);
    (game.player(1) as Player).alive = false;
    (game.player(2) as Player).alive = false;
    run();
    expect(victory.winner()).toBe(3);
    game.territory.setOwner(1, 1);
    (game.player(1) as Player).alive = true;
    run();
    expect(victory.winner()).toBe(3);
  });

  it("does not end a game played alone before its time is up", () => {
    const { game, victory, run } = newGame(1);
    game.territory.setOwner(0, 1);
    run();
    expect(victory.winner()).toBeUndefined();
  });

  it("goes to the largest territory when time is up, lowest id on a tie (R-WIN-02)", () => {
    const { game, victory, run } = newGame(3, { maxDurationTicks: 2 });
    game.territory.setOwner(0, 2);
    game.territory.setOwner(1, 3);
    run();
    expect(victory.winner()).toBeUndefined();
    run();
    expect([victory.winner(), victory.decidedAt()]).toEqual([2, 1]);
  });

  it("waits for the spawn phase to end", () => {
    const { game, victory, run } = newGame(2, { spawnPhaseTicks: 5 });
    for (let tile = 0; tile < 60; tile++) game.territory.setOwner(tile, 1);
    run();
    expect(victory.winner()).toBeUndefined();
  });
});

describe("createGame", () => {
  /** Two players spawn, then the first sends everything at the second until the game is decided. */
  function play(seed: number) {
    const { game, attacks, victory, starts } = createGame({
      terrain: plains(),
      seed,
      players: [
        { id: 1, name: "Ada" },
        { id: 2, name: "Bea" },
      ],
      balance: { ...DEFAULT_BALANCE, spawnPhaseTicks: 2, spawnDistance: 4, winSharePercent: 90 },
    });
    const orders = (tick: number): { player: number; order: Order }[] => {
      if (tick === 0) return [{ player: 1, order: { type: "spawn", tile: grid.index(2, 5) } }];
      if (tick < 2 || tick % 20 !== 0) return [];
      // Half of the troops at Bea, half at the unowned land nearest to her.
      const ada = game.player(1) as Player;
      const bea = starts.get(2) ?? 0;
      const troops = Math.floor(ada.troops / 2);
      const neutral = grid
        .tilesWithin(bea, grid.width)
        .find((t) => game.territory.ownerOf(t) === 0);
      const result = [];
      if (game.territory.ownerOf(bea) === 2) {
        result.push({ player: 1, order: { type: "attack", target: bea, troops } as Order });
      }
      if (neutral !== undefined) {
        result.push({ player: 1, order: { type: "attack", target: neutral, troops } as Order });
      }
      return result;
    };
    while (victory.winner() === undefined && game.tick < 5000) {
      game.step({ tick: game.tick, orders: orders(game.tick) });
    }
    return {
      winner: victory.winner(),
      tick: game.tick,
      owners: Array.from(game.territory.owners),
      players: game.players().map((p) => ({ ...p })),
      attacks: attacks.list().length,
    };
  }

  it("plays a whole game to a decision", () => {
    const result = play(11);
    expect(result.winner).toBe(1);
    expect(result.tick).toBeLessThan(5000);
  });

  it("reaches exactly the same state from the same setup and orders (R-FAIR-01)", () => {
    expect(play(11)).toEqual(play(11));
  });
});
