import { captureCost } from "../attacks.ts";
import { reachableCoasts } from "../boats.ts";
import { populationCap } from "../economy.ts";
import type { Game, Player } from "../game.ts";
import { divFloor, isqrt, percentOf } from "../integer-math.ts";
import { NEUTRAL } from "../territory/territory-map.ts";
import { BOT_DIFFICULTIES, type BotDifficulty } from "./difficulty.ts";

/**
 * Border tiles a bot looks at per decision. Sampling keeps a decision cheap on
 * a territory with thousands of border tiles, at the price of sometimes
 * missing a better target; the next decision draws other tiles.
 */
const BORDER_SAMPLES = 16; // B-BOT-SAMPLES

/** Coasts, closest by sea first, a bot weighs when nothing is left to take by land. */
const SEA_TARGETS = 8; // B-BOT-SEA-TARGETS

/** Water tiles from the bot's shore under which a coast does not count as another front. */
const SEA_MIN_DISTANCE = 16; // B-BOT-SEA-MIN

/**
 * Decisions a bot lets pass before searching the sea again after a search
 * found nothing: one search can walk B-BOAT-RANGE of sea.
 */
const SEA_RETRY_DECISIONS = 4; // B-BOT-SEA-RETRY

/**
 * Bots (R-BOT-01, R-BOT-03, R-BOT-04): the given players expand into unowned
 * land while some is in reach and attack weaker neighbours, keeping a reserve
 * at home. They decide from the game state and the game's Random only, and
 * act through game.apply with the orders humans send, so every client runs
 * the same decisions.
 *
 * With nothing worth taking by land, a bot sails to the closest free coast it
 * can reach, or else to the coast of a weaker player, up to B-BOAT-MAX
 * ships at sea (R-BOT-05).
 *
 * Bots do not pick a start: the spawn phase places them at random when it
 * ends (R-SPAWN-03).
 */
export function installBots(game: Game, ids: readonly number[], difficulty: BotDifficulty): void {
  const { territory, terrain, balance, random } = game;
  const topology = terrain.topology;
  const params = BOT_DIFFICULTIES[difficulty];
  const interval = Math.max(1, params.intervalSeconds * balance.ticksPerSecond);
  const bots = [...new Set(ids)].sort((a, b) => a - b);
  for (const id of bots) {
    if (!game.player(id)) throw new RangeError(`unknown player ${String(id)}`);
  }
  const around = new Int32Array(4);
  // Tick before which a bot whose last sea search found nothing does not search again.
  const nextSeaSearch = new Map<number, number>();

  game.onTick(() => {
    if (game.phase !== "play") return;
    for (const id of bots) {
      // Offset by id so that bots spread their decisions over the interval.
      if ((game.tick + id) % interval !== 0) continue;
      const bot = game.player(id) as Player;
      if (bot.alive) decide(bot);
    }
  });

  function decide(bot: Player): void {
    const tiles = territory.tileCount(bot.id);
    const borders = territory.borderCount(bot.id);
    if (tiles === 0 || borders === 0) return;
    const reserve = percentOf(populationCap(game, bot), params.reservePercent);
    const troops = Math.min(percentOf(bot.troops, params.attackRatioPercent), bot.troops - reserve);
    // Less than the price of one tile would come straight back.
    if (troops < balance.neutralCost) return;

    let neutralTarget = -1;
    let enemyTarget = -1;
    let enemyDensity = 0;
    // A large empire looks at more of its border, so a narrow land front is still found.
    const samples = Math.min(borders, Math.max(BORDER_SAMPLES, isqrt(borders)));
    for (let i = 0; i < samples; i++) {
      const index = borders <= samples ? i : random.nextInt(0, borders);
      const count = topology.neighborsInto(territory.borderTile(bot.id, index), around);
      for (let j = 0; j < count; j++) {
        const tile = around[j] as number;
        const owner = territory.ownerOf(tile);
        if (owner === bot.id || !terrain.isOwnable(tile)) continue;
        if (owner === NEUTRAL) {
          if (neutralTarget < 0) neutralTarget = tile;
          continue;
        }
        const enemy = game.player(owner);
        if (!enemy?.alive) continue;
        const density = divFloor(enemy.troops, territory.tileCount(owner));
        if (enemyTarget < 0 || density < enemyDensity) {
          enemyTarget = tile;
          enemyDensity = density;
        }
      }
    }

    const ownDensity = divFloor(bot.troops, tiles);
    const weak = enemyTarget >= 0 && enemyDensity * 100 <= ownDensity * params.boldnessPercent;
    // Free land is cheaper than a fight: while some is in reach, only a much weaker neighbour is worth attacking.
    const muchWeaker = weak && enemyDensity * 200 <= ownDensity * params.boldnessPercent;
    const target = neutralTarget >= 0 && !muchWeaker ? neutralTarget : weak ? enemyTarget : -1;
    if (target >= 0) game.apply(bot.id, { type: "attack", target, troops });
    else sail(bot, troops, ownDensity);
  }

  function sail(bot: Player, troops: number, ownDensity: number): void {
    if (game.tick < (nextSeaSearch.get(bot.id) ?? 0)) return;
    let atSea = 0;
    for (const boat of game.boats) if (boat.player === bot.id) atSea++;
    if (atSea >= balance.boatMax) return;
    // A coast just along the bot's own shore is better reached by land.
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
      if (!enemy?.alive) continue;
      const density = divFloor(enemy.troops, territory.tileCount(owner));
      if (density * 100 > ownDensity * params.boldnessPercent) continue;
      // The ship must at least pay for the beach.
      if (troops <= captureCost(game, coast, enemy)) continue;
      if (target < 0 || density < targetDensity) {
        target = coast;
        targetDensity = density;
      }
    }
    if (target >= 0) game.apply(bot.id, { type: "embark", target, troops });
    else nextSeaSearch.set(bot.id, game.tick + SEA_RETRY_DECISIONS * interval);
  }
}
