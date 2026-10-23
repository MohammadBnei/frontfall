import { createGame, installBots, loadMap, type MapDescription } from "@frontfall/engine";

export interface ScenarioResult {
  /** State hash every `CHECKPOINT` ticks, then at the end: where two runs part, the first differing entry says when. */
  readonly hashes: number[];
  readonly tiles: number[];
}

export const CHECKPOINT = 1000;

/**
 * Eight bots on a published map for a number of ticks, with no human orders:
 * everything that happens comes from the rules, the bots and the seed, so
 * every runtime must reach the same state (R-FAIR-01).
 */
export function playScenario(
  bytes: Uint8Array,
  manifest: MapDescription,
  ticks: number,
): ScenarioResult {
  const { terrain } = loadMap(bytes, manifest);
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  const game = createGame({
    terrain,
    seed: 20_261_023,
    players: ids.map((id) => ({ id, name: `Bot ${String(id)}` })),
  });
  installBots(game, ids, "normal");
  const hashes: number[] = [];
  while (game.tick < ticks) {
    game.step({ tick: game.tick, orders: [] });
    if (game.tick % CHECKPOINT === 0) hashes.push(game.hash());
  }
  if (ticks % CHECKPOINT !== 0) hashes.push(game.hash());
  return { hashes, tiles: game.players().map((p) => game.territory.tileCount(p.id)) };
}
