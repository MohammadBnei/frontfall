import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../src/balance.ts";
import { installBots } from "../src/bots/index.ts";
import { createGame } from "../src/create-game.ts";
import { DesyncReportError } from "../src/desync-report.ts";
import type { Turn } from "../src/game.ts";
import {
  GAME_RECORD_VERSION,
  readGameRecord,
  replayGameRecord,
  type GameRecord,
} from "../src/game-record.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

const terrain = new Terrain(new WorldGrid(32, 16), new Uint8Array(32 * 16).fill(TileKind.Plains));

/** Plays a short game with one bot and records it as a client would. */
function played(): GameRecord {
  const balance = { ...DEFAULT_BALANCE, spawnPhaseTicks: 5 };
  const players = [
    { id: 1, name: "Ada" },
    { id: 2, name: "Bot" },
  ];
  const game = createGame({ terrain, seed: 9, players, balance });
  installBots(game, [2], "normal");
  const turns: Turn[] = [
    { tick: 0, orders: [{ player: 1, order: { type: "spawn", tile: 40 } }] },
    { tick: 12, orders: [{ player: 1, order: { type: "attack", target: 300, troops: 300 } }] },
  ];
  const byTick = new Map(turns.map((turn) => [turn.tick, turn.orders]));
  while (game.tick < 80) game.step({ tick: game.tick, orders: byTick.get(game.tick) ?? [] });
  return {
    version: GAME_RECORD_VERSION,
    build: { release: "test", build: "abc123", protocol: 7 },
    map: { id: "plain", format: 1, version: 1, sha256: "" },
    seed: 9,
    balance,
    players,
    bots: { ids: [2], difficulty: "normal" },
    you: 1,
    ticks: game.tick,
    turns,
    hash: game.hash(),
  };
}

describe("game records (#50)", () => {
  it("replay to the hash the game reached (R-FAIR-01)", () => {
    const game = played();
    expect(replayGameRecord(game, terrain)).toBe(game.hash);
  });

  it("survive a round trip through JSON", () => {
    const game = played();
    expect(readGameRecord(JSON.parse(JSON.stringify(game)))).toEqual(game);
  });

  it("refuse another version or a damaged file", () => {
    const game = played();
    expect(() => readGameRecord({ ...game, version: 2 })).toThrow(DesyncReportError);
    expect(() => readGameRecord({ ...game, hash: "x" })).toThrow("hash is not an integer");
    expect(() => readGameRecord({ ...game, build: { release: "test" } })).toThrow(
      "build.build is not a string",
    );
    // Turns out of order or past the end would be dropped without a word.
    const turns = [...game.turns].reverse();
    expect(() => readGameRecord({ ...game, turns })).toThrow("out of order");
    expect(() => readGameRecord({ ...game, ticks: 12 })).toThrow("past the end");
    expect(() => readGameRecord({ ...game, you: 7 })).toThrow("you is not one of the players");
  });
});
