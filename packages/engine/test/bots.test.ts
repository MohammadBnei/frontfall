import { describe, expect, it, vi } from "vitest";
import { installAttacks } from "../src/attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "../src/balance.ts";
import { installBoats } from "../src/boats.ts";
import { BOT_DIFFICULTIES, installBots, type BotDifficulty } from "../src/bots/index.ts";
import { installEconomy } from "../src/economy.ts";
import { Game, type Order, type Player } from "../src/game.ts";
import { installSpawn } from "../src/spawn.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { NEUTRAL } from "../src/territory/territory-map.ts";
import { WorldGrid } from "../src/world-grid.ts";

const balance: Balance = { ...DEFAULT_BALANCE, spawnPhaseTicks: 10, spawnDistance: 12 };

/** A full game of bots only on a plains cylinder, with a lake in the middle. */
function botGame(seed: number, count: number, difficulty: BotDifficulty, width = 96, height = 48) {
  const grid = new WorldGrid(width, height);
  const kinds = new Uint8Array(grid.size).fill(TileKind.Plains);
  for (const tile of grid.tilesWithin(grid.index(width / 2, height / 2), 5)) {
    kinds[tile] = TileKind.Water;
  }
  const players = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Bot ${String(i)}`,
  }));
  const game = new Game({ terrain: new Terrain(grid, kinds), seed, players, balance });
  installSpawn(game);
  installEconomy(game);
  installAttacks(game);
  installBots(
    game,
    players.map((p) => p.id),
    difficulty,
  );
  const apply = vi.spyOn(game, "apply");
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) game.step({ tick: game.tick, orders: [] });
  };
  return { grid, game, apply, run };
}

/** Two players on a 10 x 3 cylinder, each holding whole columns, with no spawn phase. */
function duel(columns: Record<number, number[]>, difficulty: BotDifficulty = "hard") {
  const grid = new WorldGrid(10, 3);
  const game = new Game({
    terrain: new Terrain(grid, new Uint8Array(grid.size).fill(TileKind.Plains)),
    seed: 5,
    players: [
      { id: 1, name: "Bot" },
      { id: 2, name: "Ada" },
    ],
    balance: { ...balance, spawnPhaseTicks: 0 },
  });
  installAttacks(game);
  installBots(game, [1], difficulty);
  for (const [player, xs] of Object.entries(columns)) {
    for (const x of xs) {
      for (let y = 0; y < 3; y++) game.territory.setOwner(grid.index(x, y), Number(player));
    }
  }
  const apply = vi.spyOn(game, "apply");
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) game.step({ tick: game.tick, orders: [] });
  };
  return { game, apply, run, bot: game.player(1) as Player, ada: game.player(2) as Player };
}

describe("bots", () => {
  it("make the same decisions on every run with the same seed (R-BOT-03)", () => {
    const first = botGame(11, 8, "hard");
    const second = botGame(11, 8, "hard");
    first.run(400);
    second.run(400);
    expect(first.apply).toHaveBeenCalled();
    expect(second.game.territory.owners).toEqual(first.game.territory.owners);
    expect(second.game.players()).toEqual(first.game.players());
    expect(second.game.random.state()).toEqual(first.game.random.state());
  });

  it("expand into unowned land (R-BOT-01)", () => {
    const { game, run } = botGame(3, 6, "normal");
    run(balance.spawnPhaseTicks);
    const start = game.players().map((p) => game.territory.tileCount(p.id));
    const neutral = game.territory.tileCount(NEUTRAL);
    run(800);
    for (const [i, player] of game.players().entries()) {
      expect(game.territory.tileCount(player.id)).toBeGreaterThan((start[i] as number) * 4);
    }
    expect(game.territory.tileCount(NEUTRAL)).toBeLessThan(neutral / 2);
  });

  it("only send orders that the game carries out, and never all their troops (R-BOT-03)", () => {
    const { game, apply, run } = botGame(8, 16, "hard");
    const sent: { troops: number; home: number }[] = [];
    apply.mockImplementation(function (this: Game, id: number, order: Order) {
      if (order.type === "attack") {
        sent.push({ troops: order.troops, home: (game.player(id) as Player).troops });
      }
      return Game.prototype.apply.call(this, id, order);
    });
    run(1500);
    expect(apply.mock.results.length).toBeGreaterThan(100);
    expect(apply.mock.results.every((result) => result.value === true)).toBe(true);
    expect(sent.every(({ troops, home }) => troops < home)).toBe(true);
  }, 30_000);

  it("act less often on easy than on hard (R-BOT-04)", () => {
    const easy = botGame(4, 8, "easy");
    const hard = botGame(4, 8, "hard");
    easy.run(400);
    hard.run(400);
    expect(easy.apply.mock.calls.length * 2).toBeLessThan(hard.apply.mock.calls.length);
  });

  it("decide at most once per interval each, spread over the interval", () => {
    const { game, apply, run } = botGame(2, 16, "hard");
    run(balance.spawnPhaseTicks);
    const interval = BOT_DIFFICULTIES.hard.intervalSeconds * balance.ticksPerSecond;
    const ticks: number[] = [];
    apply.mockImplementation((id: number, order: Order) => {
      ticks.push(game.tick);
      expect((game.tick + id) % interval).toBe(0);
      return Game.prototype.apply.call(game, id, order);
    });
    run(interval);
    expect(new Set(ticks).size).toBeGreaterThan(1);
  });

  it("do nothing during the spawn phase and are placed at its end (R-SPAWN-03)", () => {
    const { game, apply, run } = botGame(6, 4, "hard");
    run(balance.spawnPhaseTicks);
    expect(apply).not.toHaveBeenCalled();
    for (const player of game.players())
      expect(game.territory.tileCount(player.id)).toBeGreaterThan(0);
  });

  it("attack a much weaker neighbour once no free land is left (R-BOT-01)", () => {
    const { game, run, bot, ada } = duel({ 1: [0, 1, 2, 3, 4], 2: [5, 6, 7, 8, 9] });
    bot.troops = 1000;
    ada.troops = 15;
    run(BOT_DIFFICULTIES.hard.intervalSeconds * balance.ticksPerSecond + 1);
    expect(game.territory.tileCount(1)).toBeGreaterThan(15);
  });

  it("leave a stronger neighbour alone", () => {
    const { apply, run, bot, ada } = duel({ 1: [0, 1, 2, 3, 4], 2: [5, 6, 7, 8, 9] });
    bot.troops = 1000;
    ada.troops = 5000;
    run(50);
    expect(apply).not.toHaveBeenCalled();
  });

  it("prefer free land to a neighbour that is only somewhat weaker", () => {
    const { game, apply, run, bot, ada } = duel({ 1: [0, 1, 2], 2: [3, 4, 5] });
    // Enough above the reserve, which counts the base population too.
    bot.troops = 2000;
    ada.troops = 1700;
    run(BOT_DIFFICULTIES.hard.intervalSeconds * balance.ticksPerSecond);
    expect(apply).toHaveBeenCalledOnce();
    const order = apply.mock.calls[0]?.[1] as Order;
    expect(order.type === "attack" && game.territory.ownerOf(order.target)).not.toBe(2);
  });

  it("keep their reserve at home (B-BOT-RESERVE)", () => {
    const { apply, run, bot } = duel({ 1: [0, 1, 2, 3, 4] }, "easy");
    // Cap 15 * 40 = 600, reserve 50 % = 300: 307 troops leave 7 to send, less than one tile.
    bot.troops = 307;
    run(80);
    expect(apply).not.toHaveBeenCalled();
  });

  it("sail to another land mass once theirs is full (R-BOT-05)", () => {
    // The bot holds the whole west island; the east one is free.
    const grid = new WorldGrid(20, 4);
    const cells = [
      "XXXXXXXXXXXXXXXXXXXX",
      "#11...........#####.",
      "#11..........######.",
      "XXXXXXXXXXXXXXXXXXXX",
    ].join("");
    const kinds = new Uint8Array(grid.size);
    for (let tile = 0; tile < grid.size; tile++) {
      const cell = cells[tile] as string;
      kinds[tile] =
        cell === "." ? TileKind.Water : cell === "X" ? TileKind.Impassable : TileKind.Plains;
    }
    const game = new Game({
      terrain: new Terrain(grid, kinds),
      seed: 5,
      players: [{ id: 1, name: "Bot" }],
      balance: { ...balance, spawnPhaseTicks: 0, attackSpeedDivisor: 1000 },
    });
    installAttacks(game);
    installBoats(game);
    installBots(game, [1], "hard");
    for (const x of [0, 1, 2]) {
      for (const y of [1, 2]) game.territory.setOwner(grid.index(x, y), 1);
    }
    const apply = vi.spyOn(game, "apply");
    (game.player(1) as Player).troops = 2000;
    for (let i = 0; i < BOT_DIFFICULTIES.hard.intervalSeconds * balance.ticksPerSecond; i++) {
      game.step({ tick: game.tick, orders: [] });
    }
    expect(apply).toHaveBeenCalledOnce();
    const order = apply.mock.calls[0]?.[1] as Order;
    expect(order.type).toBe("embark");
    expect(order.type === "embark" && game.terrain.landmassOf(order.target)).toBe(
      game.terrain.landmassOf(grid.index(14, 1)),
    );
    expect(game.boats).toHaveLength(1);
  });

  it("stop once eliminated", () => {
    const { apply, run, bot } = duel({ 1: [0, 1, 2, 3, 4] });
    bot.troops = 1000;
    bot.alive = false;
    run(50);
    expect(apply).not.toHaveBeenCalled();
  });

  it("refuse unknown players", () => {
    const { game } = duel({});
    expect(() => {
      installBots(game, [3], "easy");
    }).toThrow(RangeError);
  });
});
