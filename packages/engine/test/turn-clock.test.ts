import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import { createGame } from "../src/create-game.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { TurnClock } from "../src/turn-clock.ts";
import { WorldGrid } from "../src/world-grid.ts";

describe("TurnClock", () => {
  const grid = new WorldGrid(20, 10);
  const newGame = () =>
    createGame({
      terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
      seed: 4,
      players: [
        { id: 1, name: "Ada" },
        { id: 2, name: "Bea" },
      ],
      balance: { ...DEFAULT_BALANCE, spawnPhaseTicks: 3, spawnDistance: 5 },
    });

  it("numbers turns from the game's tick and runs queued orders in submission order", () => {
    const game = newGame();
    const clock = new TurnClock(game);
    clock.submit(2, { type: "spawn", tile: grid.index(15, 5) });
    clock.submit(1, { type: "spawn", tile: grid.index(3, 5) });

    const first = clock.advance();
    expect(first.tick).toBe(0);
    expect(first.orders.map((o) => o.player)).toEqual([2, 1]);
    expect(game.player(1)?.start).toBe(grid.index(3, 5));
    expect(clock.advance()).toEqual({ tick: 1, orders: [] });
    expect(game.tick).toBe(2);
  });

  it("gives the same game as stepping the same turns by hand", () => {
    const viaClock = newGame();
    const clock = new TurnClock(viaClock);
    const byHand = newGame();
    for (let tick = 0; tick < 40; tick++) {
      if (tick === 0) clock.submit(1, { type: "spawn", tile: grid.index(3, 5) });
      if (tick === 5) clock.submit(1, { type: "attack", target: grid.index(9, 5), troops: 900 });
      byHand.step(clock.advance());
    }
    expect(viaClock.hash()).toBe(byHand.hash());
  });
});
