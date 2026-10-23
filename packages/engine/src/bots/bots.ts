import { populationCap } from "../economy.ts";
import type { Game, Player } from "../game.ts";
import { divFloor, percentOf } from "../integer-math.ts";
import { NEUTRAL } from "../territory/territory-map.ts";
import { BOT_DIFFICULTIES, type BotDifficulty } from "./difficulty.ts";

/**
 * Border tiles a bot looks at per decision. Sampling keeps a decision cheap on
 * a territory with thousands of border tiles, at the price of sometimes
 * missing a better target; the next decision draws other tiles.
 */
const BORDER_SAMPLES = 16;

/**
 * Bots (R-BOT-01, R-BOT-03, R-BOT-04): the given players expand into unowned
 * land while some is in reach and attack weaker neighbours, keeping a reserve
 * at home. They decide from the game state and the game's Random only, and
 * act through game.apply with the orders humans send, so every client runs
 * the same decisions.
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
    const samples = Math.min(borders, BORDER_SAMPLES);
    for (let i = 0; i < samples; i++) {
      const index = borders <= BORDER_SAMPLES ? i : random.nextInt(0, borders);
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
  }
}
