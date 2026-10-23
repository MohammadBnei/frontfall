import type { Game, Player } from "./game.ts";
import { NEUTRAL } from "./territory/territory-map.ts";

/** Random draws allowed when placing a player who did not pick, before giving up on spacing. */
const PLACEMENT_ATTEMPTS = 1000;

/**
 * The spawn phase (R-SPAWN-01 to R-SPAWN-05). Players pick a start tile, and
 * may pick again until the phase ends; whoever has not picked by then is
 * placed at random. Each player's start is kept in `player.start`.
 */
export function installSpawn(game: Game): void {
  game.onOrder((_, player, order) => {
    if (order.type !== "spawn" || !isValidStart(game, player, order.tile)) return false;
    place(game, player, order.tile);
    return true;
  });

  game.onTick(() => {
    // The system runs before the tick counter moves: this is the last tick of the phase.
    if (game.tick !== game.balance.spawnPhaseTicks - 1) return;
    for (const player of game.players()) {
      if (player.alive && player.start === undefined) placeAtRandom(game, player);
    }
  });
}

/** R-SPAWN-02: unowned ownable land, or the player's own, far enough from every other start. */
function isValidStart(
  game: Game,
  player: Player,
  tile: number,
  minDistance = game.balance.spawnDistance,
): boolean {
  if (!game.terrain.isOwnable(tile)) return false;
  const owner = game.territory.ownerOf(tile);
  if (owner !== NEUTRAL && owner !== player.id) return false;
  const topology = game.terrain.topology;
  for (const other of game.players()) {
    if (other === player || other.start === undefined) continue;
    if (topology.distance(other.start, tile) < minDistance) return false;
  }
  return true;
}

/** R-SPAWN-04: the tiles around the start, and the starting troops. Moving the start releases the old area. */
function place(game: Game, player: Player, tile: number): void {
  const { territory, terrain } = game;
  if (player.start !== undefined) {
    for (const old of terrain.topology.tilesWithin(player.start, game.balance.spawnRadius)) {
      if (territory.ownerOf(old) === player.id) territory.setOwner(old, NEUTRAL);
    }
  }
  for (const claimed of terrain.topology.tilesWithin(tile, game.balance.spawnRadius)) {
    if (terrain.isOwnable(claimed) && territory.ownerOf(claimed) === NEUTRAL) {
      territory.setOwner(claimed, player.id);
    }
  }
  player.start = tile;
  player.troops = game.balance.startTroops;
}

/**
 * R-SPAWN-03: a random valid tile drawn from the game's seed. On a crowded map
 * where no tile is far enough from the others, spacing is relaxed rather than
 * leaving the player out; on a map with no free land at all the player stays
 * unplaced, and is eliminated when play starts (R-ECO-05).
 */
function placeAtRandom(game: Game, player: Player): void {
  const size = game.terrain.topology.size;
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const tile = game.random.nextInt(0, size);
    if (isValidStart(game, player, tile)) {
      place(game, player, tile);
      return;
    }
  }
  const offset = game.random.nextInt(0, size);
  for (let i = 0; i < size; i++) {
    const tile = (offset + i) % size;
    if (isValidStart(game, player, tile, 0)) {
      place(game, player, tile);
      return;
    }
  }
}
