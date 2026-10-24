import type { Game, Player } from "./game.ts";
import { divFloor, mulDiv } from "./integer-math.ts";
import { spawnSettings } from "./spawn.ts";
import { NEUTRAL } from "./territory/territory-map.ts";

/** What a structure is (R-BUILD). The number is its code in build orders: never renumber. */
export const StructureKind = {
  City: 0,
  Fort: 1,
} as const;
export type StructureKind = (typeof StructureKind)[keyof typeof StructureKind];

const HIGHEST_KIND: number = StructureKind.Fort;

/** A structure on one land tile. It works from `readyAt` on, and changes hands with its tile. */
export interface Structure {
  readonly id: number;
  player: number;
  readonly kind: StructureKind;
  readonly tile: number;
  /** First tick the structure works (B-BUILD-TIME after the order). */
  readonly readyAt: number;
}

export function isStructureKind(kind: number): kind is StructureKind {
  return Number.isInteger(kind) && kind >= 0 && kind <= HIGHEST_KIND;
}

export function isReady(game: Game, structure: Structure): boolean {
  return game.tick >= structure.readyAt;
}

export function structureAt(game: Game, tile: number): Structure | undefined {
  return game.structures.find((structure) => structure.tile === tile);
}

/** Structures of one kind a player owns, those still being built included. */
export function structureCount(game: Game, player: number, kind: StructureKind): number {
  let count = 0;
  for (const structure of game.structures) {
    if (structure.player === player && structure.kind === kind) count++;
  }
  return count;
}

/**
 * Gold the next structure of a kind costs a player: its base cost, times
 * B-COST-GROWTH for each one of that kind they already own (R-BUILD).
 */
export function structureCost(game: Game, player: number, kind: StructureKind): number {
  const { cityCost, fortCost, costGrowthPercent } = game.balance;
  let cost = kind === StructureKind.City ? cityCost : fortCost;
  const owned = structureCount(game, player, kind);
  for (let i = 0; i < owned && cost < Number.MAX_SAFE_INTEGER; i++) {
    cost = Math.min(Number.MAX_SAFE_INTEGER, mulDiv(cost, costGrowthPercent, 100));
  }
  return cost;
}

/** R-BUILD-07: most cities a player's land supports, one for every B-CITY-LAND tiles, the first one free. */
export function cityLimit(game: Game, player: number): number {
  return 1 + divFloor(game.territory.tileCount(player), cityLand(game));
}

/** Cities that raise a player's population cap: ready ones, up to what their land supports (R-BUILD-01). */
export function workingCities(game: Game, player: Player): number {
  let ready = 0;
  for (const structure of game.structures) {
    if (
      structure.player === player.id &&
      structure.kind === StructureKind.City &&
      isReady(game, structure)
    ) {
      ready++;
    }
  }
  return Math.min(ready, cityLimit(game, player.id));
}

/**
 * Why a structure of this kind cannot go on this tile for this player, or
 * undefined when it can. The tile is already known to be on the map and ownable.
 */
export function placementError(
  game: Game,
  player: Player,
  kind: StructureKind,
  tile: number,
): string | undefined {
  if (game.territory.ownerOf(tile) !== player.id) return "the tile is not yours";
  const spacing = game.balance.buildSpacing;
  const topology = game.terrain.topology;
  for (const structure of game.structures) {
    if (topology.distance(structure.tile, tile) < spacing) return "too close to another structure";
  }
  if (
    kind === StructureKind.City &&
    structureCount(game, player.id, kind) >= cityLimit(game, player.id)
  ) {
    return "not enough land for another city";
  }
  if (player.gold < structureCost(game, player.id, kind)) return "not enough gold";
  return undefined;
}

/**
 * Radius of a fort on this map, in tiles: B-FORT-RADIUS on a map of 2^19
 * tiles, growing with the side of larger maps like the spawn radius.
 */
export function fortRadius(game: Game): number {
  const { spawnRadius, fortRadius: radius } = game.balance;
  return Math.max(radius, mulDiv(radius, spawnSettings(game).radius, spawnRadius));
}

/** Tiles of land per city a player may own beyond the first, scaled like the spawn area. */
function cityLand(game: Game): number {
  const { spawnRadius, cityLand: land } = game.balance;
  const radius = spawnSettings(game).radius;
  return Math.max(1, mulDiv(land, radius * radius, spawnRadius * spawnRadius));
}

/** R-BUILD-03: whether a ready fort of the tile's owner stands within its radius of the tile. */
export function fortified(game: Game, tile: number, owner: number): boolean {
  if (owner === NEUTRAL) return false;
  const topology = game.terrain.topology;
  const radius = fortRadius(game);
  for (const structure of game.structures) {
    if (
      structure.kind === StructureKind.Fort &&
      structure.player === owner &&
      // Taken earlier in this tick, before the structures changed hands.
      game.territory.ownerOf(structure.tile) === owner &&
      isReady(game, structure) &&
      topology.distance(structure.tile, tile) <= radius
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Structures (R-BUILD-01, R-BUILD-03, R-BUILD-06, R-BUILD-07). A build order
 * takes the gold at once and the structure works B-BUILD-TIME later; a
 * demolish order removes one of the player's structures with no refund.
 * After the attacks of each tick, every structure goes to the owner of its
 * tile. Structures live in `game.structures`, oldest first.
 */
export function installStructures(game: Game): void {
  const structures = game.structures;

  game.onOrder((_, player, order) => {
    if (order.type !== "build" || !isStructureKind(order.structure)) return false;
    player.gold -= structureCost(game, player.id, order.structure);
    structures.push({
      id: game.nextStructureId++,
      player: player.id,
      kind: order.structure,
      tile: order.tile,
      readyAt: game.tick + game.balance.buildTicks,
    });
    return true;
  });

  game.onOrder((_, player, order) => {
    if (order.type !== "demolish") return false;
    const index = structures.findIndex((s) => s.tile === order.tile && s.player === player.id);
    if (index < 0) return false;
    structures.splice(index, 1);
    return true;
  });

  game.onTick(() => {
    let kept = 0;
    for (const structure of structures) {
      const owner = game.territory.ownerOf(structure.tile);
      // Should land ever go back to nobody, what stood on it goes too.
      if (owner === NEUTRAL) continue;
      structure.player = owner;
      structures[kept++] = structure;
    }
    structures.length = kept;
  });
}
