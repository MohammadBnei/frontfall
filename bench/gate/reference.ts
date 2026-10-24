import type * as Engine from "@frontfall/engine";

export interface ReferenceOptions {
  readonly players: number;
  /** Ticks to play, spawn phase included. */
  readonly ticks: number;
  readonly seed: number;
  /**
   * Extra busy time added to every tick, in percent of its own duration: an
   * engine that is that much slower, to check that the gate catches it.
   */
  readonly slowdownPercent?: number;
}

export interface ReferenceResult {
  /** Wall time of every tick after the spawn phase, in milliseconds. */
  readonly durations: number[];
  readonly ticks: number;
  readonly alive: number;
  readonly cities: number;
  readonly forts: number;
  readonly hash: number;
}

export const REFERENCE: ReferenceOptions = { players: 64, ticks: 3000, seed: 2026 };

/** Ticks between two rounds of fort orders. */
const FORT_INTERVAL = 50;
/** Forts each bot with an even id is ordered to hold at most. */
const FORTS_PER_PLAYER = 2;

/**
 * The reference game of the performance gate: bots on a real map, the way a
 * full lobby plays, with nobody else giving orders. Bots build cities but not
 * forts, so every FORT_INTERVAL ticks every other bot, when it can pay for one,
 * is also ordered to put a fort on a tile of its border: attacks then go through
 * fortified land, which changes their price and the defender's losses.
 *
 * The engine is passed in rather than imported, so the same game can be
 * played on two versions of it. Only long-standing parts of its API are used,
 * so that an older version can still run it.
 */
export function playReference(
  engine: typeof Engine,
  terrain: Engine.Terrain,
  options: ReferenceOptions = REFERENCE,
): ReferenceResult {
  const ids = Array.from({ length: options.players }, (_, i) => i + 1);
  const game = engine.createGame({
    terrain,
    seed: options.seed,
    players: ids.map((id) => ({ id, name: `Bot ${String(id)}` })),
  });
  engine.installBots(game, ids, "normal");
  const fort = engine.StructureKind.Fort;
  // The harness's own generator, so that its picks do not shift the game's draws.
  let state = options.seed >>> 0 || 1;
  const pick = (count: number): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % count;
  };

  const durations: number[] = [];
  while (game.tick < options.ticks && game.winner === undefined) {
    const orders: Engine.Turn["orders"][number][] = [];
    if (game.phase === "play" && game.tick % FORT_INTERVAL === 0) {
      for (const player of game.players()) {
        if (!player.alive || player.id % 2 !== 0) continue;
        if (engine.structureCount(game, player.id, fort) >= FORTS_PER_PLAYER) continue;
        if (player.gold < engine.structureCost(game, player.id, fort)) continue;
        const borders = game.territory.borderCount(player.id);
        if (borders === 0) continue;
        const tile = game.territory.borderTile(player.id, pick(borders));
        orders.push({ player: player.id, order: { type: "build", structure: fort, tile } });
      }
    }
    const play = game.phase === "play";
    const start = performance.now();
    game.step({ tick: game.tick, orders });
    let elapsed = performance.now() - start;
    if (options.slowdownPercent) {
      const until = start + elapsed * (1 + options.slowdownPercent / 100);
      while (performance.now() < until);
      elapsed = performance.now() - start;
    }
    if (play) durations.push(elapsed);
  }

  let cities = 0;
  let forts = 0;
  for (const structure of game.structures) {
    if (structure.kind === fort) forts++;
    else cities++;
  }
  return {
    durations,
    ticks: game.tick,
    alive: game.players().filter((p) => p.alive).length,
    cities,
    forts,
    hash: game.hash(),
  };
}
