import type { Game, Player } from "./game.ts";
import { mulDiv } from "./integer-math.ts";
import { spawnSettings } from "./spawn.ts";

/**
 * R-ECO-01: the most troops a player's territory and cities can hold. A base
 * equal to the starting troops of the map comes on top, so a player who has
 * just spawned, or is down to a few tiles, still grows. Land beyond a share of
 * the map counts for less (R-ECO-06), so the largest empires stop refilling
 * as fast as they can be taken apart.
 */
export function populationCap(game: Game, player: Player, cities = 0): number {
  const { popPerTile, popPerCity, popFalloffSharePercent, popFalloffPercent } = game.balance;
  const base = spawnSettings(game).troops;
  const tiles = game.territory.tileCount(player.id);
  // Past B-POP-FALLOFF-SHARE of the land, each tile holds only B-POP-FALLOFF of the usual troops.
  const full = Math.min(tiles, mulDiv(game.terrain.ownableCount, popFalloffSharePercent, 100));
  const land = full * popPerTile + mulDiv((tiles - full) * popPerTile, popFalloffPercent, 100);
  return base + land + cities * popPerCity;
}

/**
 * Growth of troops and gold every tick of play (R-ECO-01 to R-ECO-05), and
 * elimination of players left without land.
 */
export function installEconomy(game: Game): void {
  // Gold earned per tick is often fractional: players carry the remainder, in
  // units of 1 / goldDivisor, so small players are not rounded down to nothing.
  const goldDivisor = 1000 * game.balance.ticksPerSecond;

  game.onTick(() => {
    if (game.phase !== "play") return;
    for (const player of game.players()) {
      if (!player.alive) continue;
      if (game.territory.tileCount(player.id) === 0) {
        eliminate(player);
        continue;
      }
      growTroops(game, player);

      const earned = player.troops * game.balance.goldPerThousandTroops + player.goldRemainder;
      player.gold += Math.floor(earned / goldDivisor);
      player.goldRemainder = earned % goldDivisor;
    }
  });
}

/** R-ECO-02: fastest far below the cap, zero at the cap. Troops above the cap stay but do not grow. */
function growTroops(game: Game, player: Player): void {
  const gap = populationCap(game, player) - player.troops;
  if (gap <= 0) return;
  const { growthBasisPoints, ticksPerSecond } = game.balance;
  // At least one troop, or a player close to the cap would never reach it.
  player.troops += Math.max(1, mulDiv(gap, growthBasisPoints, 10_000 * ticksPerSecond));
}

/** R-ECO-05: an eliminated player keeps nothing. */
function eliminate(player: Player): void {
  player.alive = false;
  player.troops = 0;
  player.gold = 0;
  player.goldRemainder = 0;
}
