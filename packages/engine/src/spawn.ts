import type { Game, Player } from "./game.ts";
import { NEUTRAL } from "./territory/territory-map.ts";

/** Random draws allowed when placing a player who did not pick, before giving up on spacing. */
const PLACEMENT_ATTEMPTS = 1000;

/**
 * The spawn phase (R-SPAWN-01 to R-SPAWN-05). Players pick a start tile, and
 * may pick again until the phase ends; whoever has not picked by then is
 * placed at random. Returns the start tile of each player, by id.
 */
export function installSpawn(game: Game): ReadonlyMap<number, number> {
  const starts = new Map<number, number>();

  game.onOrder((_, player, order) => {
    if (order.type !== "spawn" || !isValidStart(game, starts, player, order.tile)) return false;
    place(game, starts, player, order.tile);
    return true;
  });

  game.onTick(() => {
    // The system runs before the tick counter moves: this is the last tick of the phase.
    if (game.tick !== game.balance.spawnPhaseTicks - 1) return;
    for (const player of game.players()) {
      if (player.alive && !starts.has(player.id)) placeAtRandom(game, starts, player);
    }
  });

  return starts;
}

/** R-SPAWN-02: unowned ownable land, far enough from every other player's start. */
function isValidStart(
  game: Game,
  starts: ReadonlyMap<number, number>,
  player: Player,
  tile: number,
  minDistance = game.balance.spawnDistance,
): boolean {
  if (!game.terrain.isOwnable(tile)) return false;
  const owner = game.territory.ownerOf(tile);
  if (owner !== NEUTRAL && owner !== player.id) return false;
  const topology = game.terrain.topology;
  for (const [id, start] of starts) {
    if (id !== player.id && topology.distance(start, tile) < minDistance) return false;
  }
  return true;
}

/** R-SPAWN-04: the tiles around the start, and the starting troops. Moving the start releases the old area. */
function place(game: Game, starts: Map<number, number>, player: Player, tile: number): void {
  const { territory, terrain } = game;
  const previous = starts.get(player.id);
  if (previous !== undefined) {
    for (const old of terrain.topology.tilesWithin(previous, game.balance.spawnRadius)) {
      if (territory.ownerOf(old) === player.id) territory.setOwner(old, NEUTRAL);
    }
  }
  for (const claimed of terrain.topology.tilesWithin(tile, game.balance.spawnRadius)) {
    if (terrain.isOwnable(claimed) && territory.ownerOf(claimed) === NEUTRAL) {
      territory.setOwner(claimed, player.id);
    }
  }
  starts.set(player.id, tile);
  player.troops = game.balance.startTroops;
}

/**
 * R-SPAWN-03: a random valid tile drawn from the game's seed. On a crowded map
 * where no tile is far enough from the others, spacing is relaxed rather than
 * leaving the player out; a map with no free land at all leaves them unplaced.
 */
function placeAtRandom(game: Game, starts: Map<number, number>, player: Player): void {
  const size = game.terrain.topology.size;
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const tile = game.random.nextInt(0, size);
    if (isValidStart(game, starts, player, tile)) {
      place(game, starts, player, tile);
      return;
    }
  }
  const offset = game.random.nextInt(0, size);
  for (let i = 0; i < size; i++) {
    const tile = (offset + i) % size;
    if (isValidStart(game, starts, player, tile, 0)) {
      place(game, starts, player, tile);
      return;
    }
  }
}
