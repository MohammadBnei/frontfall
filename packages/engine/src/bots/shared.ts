import { captureCost } from "../attacks.ts";
import { reachableCoasts } from "../boats.ts";
import { isAllied } from "../diplomacy.ts";
import type { Game, Player } from "../game.ts";
import { divFloor, isqrt } from "../integer-math.ts";
import { StructureKind, cityLimit, structureCost, structureCount } from "../structures.ts";
import { NEUTRAL } from "../territory/territory-map.ts";

/**
 * Border tiles a computer player looks at per decision. Sampling keeps a
 * decision cheap on a territory with thousands of border tiles, at the price
 * of sometimes missing a better target; the next decision draws other tiles.
 */
const BORDER_SAMPLES = 16; // B-BOT-SAMPLES

/** Coasts, closest by sea first, weighed when nothing is left to take by land. */
const SEA_TARGETS = 8; // B-BOT-SEA-TARGETS

/** Water tiles from the player's shore under which a coast does not count as another front. */
const SEA_MIN_DISTANCE = 16; // B-BOT-SEA-MIN

/**
 * Decisions let pass before searching again after a search found nothing:
 * one sea search can walk B-BOAT-RANGE of sea.
 */
export const RETRY_DECISIONS = 4; // B-BOT-SEA-RETRY

/** Tiles around its start within which a computer player looks for room for a city. */
const CITY_SEARCH_RADIUS = 40; // B-BOT-CITY-SEARCH

/** Owners a computer player is willing to attack; unowned land is always fair game. */
export type OwnerFilter = (owner: number) => boolean;

const anyone: OwnerFilter = () => true;

export interface BorderScan {
  /** A free tile next to the player's land, or -1. */
  neutral: number;
  /** A tile of the least dense neighbour `accept` let through, or -1, and that neighbour's troops per tile. */
  enemy: number;
  enemyDensity: number;
}

/**
 * What lies across a sample of the player's border: free land, and the
 * neighbour with the fewest troops per tile. A large empire looks at more of
 * its border, so a narrow land front is still found (R-BOT-05).
 */
export function scanBorder(game: Game, bot: Player, accept: OwnerFilter = anyone): BorderScan {
  const { territory, terrain, random } = game;
  const around = new Int32Array(4);
  const borders = territory.borderCount(bot.id);
  const scan: BorderScan = { neutral: -1, enemy: -1, enemyDensity: 0 };
  const samples = Math.min(borders, Math.max(BORDER_SAMPLES, isqrt(borders)));
  for (let i = 0; i < samples; i++) {
    const index = borders <= samples ? i : random.nextInt(0, borders);
    const count = terrain.topology.neighborsInto(territory.borderTile(bot.id, index), around);
    for (let j = 0; j < count; j++) {
      const tile = around[j] as number;
      const owner = territory.ownerOf(tile);
      if (owner === bot.id || !terrain.isOwnable(tile)) continue;
      if (isAllied(game, bot.id, owner)) continue;
      if (owner === NEUTRAL) {
        if (scan.neutral < 0) scan.neutral = tile;
        continue;
      }
      const enemy = game.player(owner);
      if (!enemy?.alive || !accept(owner)) continue;
      const density = divFloor(enemy.troops, territory.tileCount(owner));
      if (scan.enemy < 0 || density < scan.enemyDensity) {
        scan.enemy = tile;
        scan.enemyDensity = density;
      }
    }
  }
  return scan;
}

/**
 * Tick before which a player whose last search of a kind found nothing does
 * not search again, by player id.
 */
export type Cooldowns = Map<number, number>;

/** R-BOT-06: a city on the closest free inland tile to the player's start, or to a border tile once the start is lost. */
export function buildCity(game: Game, bot: Player, cooldowns: Cooldowns, retryTicks: number): void {
  const { territory, terrain, balance, random } = game;
  const topology = terrain.topology;
  const kind = StructureKind.City;
  if (bot.gold < structureCost(game, bot.id, kind)) return;
  if (structureCount(game, bot.id, kind) >= cityLimit(game, bot.id)) return;
  if (game.tick < (cooldowns.get(bot.id) ?? 0)) return;
  const start = bot.start;
  const center =
    start !== undefined && territory.ownerOf(start) === bot.id
      ? start
      : territory.borderTile(bot.id, random.nextInt(0, territory.borderCount(bot.id)));
  const spacing = balance.buildSpacing;
  // Structures close enough to rule out a tile in the search area.
  const radius = CITY_SEARCH_RADIUS + spacing;
  const nearby = game.structures.filter((s) => topology.distance(s.tile, center) < radius);
  let best = -1;
  let bestDistance = 0;
  for (const tile of topology.tilesWithin(center, CITY_SEARCH_RADIUS)) {
    if (territory.ownerOf(tile) !== bot.id || territory.isBorder(tile)) continue;
    if (nearby.some((s) => topology.distance(s.tile, tile) < spacing)) continue;
    const distance = topology.distance(tile, center);
    // Row order breaks ties, the same on every client.
    if (best < 0 || distance < bestDistance) {
      best = tile;
      bestDistance = distance;
    }
  }
  if (best >= 0) game.apply(bot.id, { type: "build", structure: kind, tile: best });
  else cooldowns.set(bot.id, game.tick + retryTicks);
}

/**
 * R-BOT-05: a ship to the closest free coast away from the player's shore,
 * or else to the coast of the least dense player `accept` lets through, if
 * that player is at most `boldnessPercent` of the player's own density.
 */
export function sail(
  game: Game,
  bot: Player,
  troops: number,
  boldnessPercent: number,
  cooldowns: Cooldowns,
  retryTicks: number,
  accept: OwnerFilter = anyone,
): void {
  const { territory, balance } = game;
  if (game.tick < (cooldowns.get(bot.id) ?? 0)) return;
  let atSea = 0;
  for (const boat of game.boats) if (boat.player === bot.id) atSea++;
  if (atSea >= balance.boatMax) return;
  const ownDensity = divFloor(bot.troops, territory.tileCount(bot.id));
  // A coast just along the player's own shore is better reached by land.
  const elsewhere = (_: number, distance: number) => distance >= SEA_MIN_DISTANCE;
  let target = -1;
  let targetDensity = 0;
  for (const coast of reachableCoasts(game, bot.id, SEA_TARGETS, elsewhere)) {
    const owner = territory.ownerOf(coast);
    if (owner === NEUTRAL) {
      // Unless the beach is too steep for what the ship carries (R-ATTACK-09).
      if (troops <= captureCost(game, coast, undefined)) continue;
      target = coast;
      break;
    }
    const enemy = game.player(owner);
    if (!enemy?.alive || isAllied(game, bot.id, owner) || !accept(owner)) continue;
    const density = divFloor(enemy.troops, territory.tileCount(owner));
    if (density * 100 > ownDensity * boldnessPercent) continue;
    // The ship must at least pay for the beach.
    if (troops <= captureCost(game, coast, enemy)) continue;
    if (target < 0 || density < targetDensity) {
      target = coast;
      targetDensity = density;
    }
  }
  if (target >= 0) game.apply(bot.id, { type: "embark", target, troops });
  else cooldowns.set(bot.id, game.tick + retryTicks);
}
