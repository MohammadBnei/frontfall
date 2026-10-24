import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { installBots } from "../src/bots/index.ts";
import { createGame } from "../src/create-game.ts";
import { DiplomacyError, isAllied, sameTeam } from "../src/diplomacy.ts";
import type { Player } from "../src/game.ts";
import { orderError } from "../src/orders.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = { ...DEFAULT_BALANCE, spawnPhaseTicks: 0 };

/** A 100 × 10 plain, a strip of ten columns for each player in id order. */
function newGame(players: number, teams: number, overrides: Partial<Balance> = {}) {
  const grid = new WorldGrid(100, 10, { wrapsX: false });
  const game = createGame({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 1,
    players: Array.from({ length: players }, (_, i) => ({ id: i + 1, name: `P${String(i + 1)}` })),
    balance: { ...balance, ...overrides },
    teams,
  });
  const give = (player: number, from: number, to: number) => {
    for (let tile = 0; tile < grid.size; tile++) {
      const x = grid.x(tile);
      if (x >= from && x < to) game.territory.setOwner(tile, player);
    }
  };
  return { game, grid, give };
}

describe("teams (R-MODE-02)", () => {
  it("deal the players in turn, so team sizes differ by one at most", () => {
    const { game } = newGame(8, 3);
    expect(game.players().map((p) => p.team)).toEqual([1, 2, 3, 1, 2, 3, 1, 2]);
    expect(
      newGame(4, 0)
        .game.players()
        .map((p) => p.team),
    ).toEqual([0, 0, 0, 0]);
    expect(() => newGame(4, 1)).toThrow(RangeError);
    expect(() => newGame(4, 5)).toThrow(RangeError);
  });

  it("make teammates allies for the whole game, who cannot ally or betray", () => {
    const { game, grid, give } = newGame(4, 2);
    give(1, 0, 10);
    give(3, 10, 20);
    expect(sameTeam(game, 1, 3)).toBe(true);
    expect(sameTeam(game, 1, 2)).toBe(false);
    expect(isAllied(game, 1, 3)).toBe(true);
    const p1 = game.player(1) as Player;
    p1.troops = 10_000;
    expect(orderError(game, p1, { type: "attack", target: grid.index(12, 5), troops: 100 })).toBe(
      DiplomacyError.Ally,
    );
    expect(orderError(game, p1, { type: "ally", target: 3 })).toBe(DiplomacyError.Teammate);
    expect(orderError(game, p1, { type: "betray", target: 3 })).toBe(DiplomacyError.Teammate);
    // Other teams follow R-DIPLO.
    expect(orderError(game, p1, { type: "ally", target: 2 })).toBeUndefined();
    // Long after any alliance would have run out, teammates still are.
    for (let i = 0; i < balance.allianceTicks + 10; i++) game.step({ tick: game.tick, orders: [] });
    expect(isAllied(game, 1, 3)).toBe(true);
  });

  it("win together on B-WIN-SHARE of the land", () => {
    // Team 1 (players 1 and 3) holds 40 + 34 columns of 100, then 75.
    const { game, give } = newGame(4, 2);
    give(1, 0, 40);
    give(3, 40, 74);
    give(2, 74, 85);
    give(4, 85, 100);
    game.step({ tick: 0, orders: [] });
    expect(game.winner).toBeUndefined();
    give(3, 74, 75);
    game.step({ tick: 1, orders: [] });
    expect(game.winningTeam).toBe(1);
    // The member with the most land.
    expect(game.winner).toBe(1);
  });

  it("end when one team is left, and with the most land when time runs out", () => {
    const last = newGame(4, 2);
    last.give(2, 0, 5);
    last.give(4, 5, 10);
    for (const id of [1, 3]) (last.game.player(id) as Player).alive = false;
    last.game.step({ tick: 0, orders: [] });
    expect(last.game.winningTeam).toBe(2);
    expect(last.game.winner).toBe(2);

    const timed = newGame(6, 3, { maxDurationTicks: 1 });
    timed.give(1, 0, 20);
    timed.give(2, 20, 45);
    timed.give(5, 45, 50);
    timed.give(3, 50, 60);
    timed.give(6, 60, 80);
    // Team 3 (players 3 and 6) holds 30 columns, team 2 (2 and 5) 30 too, team 1 only 20.
    timed.game.step({ tick: 0, orders: [] });
    expect(timed.game.winningTeam).toBe(2);
    expect(timed.game.winner).toBe(2);
  });

  it("count teammates among a bot's allies, so a bot with a teammate takes no other ally (R-BOT-10)", () => {
    const { game, give } = newGame(4, 2);
    // Player 2 is a bot on team 2 with player 4; player 1 asks it for an alliance.
    installBots(game, [2], "easy");
    give(1, 0, 10);
    give(2, 10, 60);
    give(3, 60, 80);
    give(4, 80, 100);
    for (const player of game.players()) player.troops = 1000;
    game.step({ tick: 0, orders: [{ player: 1, order: { type: "ally", target: 2 } }] });
    for (let i = 0; i < 100; i++) game.step({ tick: game.tick, orders: [] });
    expect(isAllied(game, 1, 2)).toBe(false);
  });
});
