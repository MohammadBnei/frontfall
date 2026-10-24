import { populationCap } from "../economy.ts";
import type { Game, Player } from "../game.ts";
import { divFloor, percentOf } from "../integer-math.ts";
import { StructureKind, fortRadius, placementError, structureCost } from "../structures.ts";
import { NEUTRAL } from "../territory/territory-map.ts";
import { BOT_DIFFICULTIES, type BotDifficulty } from "./difficulty.ts";
import {
  RETRY_DECISIONS,
  buildCity,
  buildPort,
  sail,
  scanBorder,
  type Cooldowns,
  type OwnerFilter,
} from "./shared.ts";

/** A nation attacks a player whose troops per tile are at most this share of its own. */
export const NATION_ODDS_PERCENT = 80; // B-NATION-ODDS

/** Troops, in % of its population cap, from which a nation attacks as boldly as a bot: its army can grow no more. */
export const NATION_FULL_PERCENT = 90; // B-NATION-FULL

/** Seconds of play during which a nation opens no front against a player: it settles its land first. */
export const NATION_GRACE_SECONDS = 120; // B-NATION-GRACE

/** An attack counts as a threat to a nation from this share of the nation's troops: smaller ones do not stop it. */
export const NATION_THREAT_PERCENT = 10; // B-NATION-THREAT

/** Under attack, a nation answers only with more troops than this share of its population cap. */
export const NATION_HOLD_PERCENT = 60; // B-NATION-HOLD

/** Points of population cap a nation keeps at home on top of the reserve of a bot of the same difficulty. */
export const NATION_EXTRA_RESERVE = 10; // B-NATION-RESERVE

/** Tiles from the attacker's land within which a nation puts a fort, as far back as it can. */
const FORT_SETBACK = 8;

/**
 * Nations (R-BOT-02, R-BOT-07 to R-BOT-09): computer players named after a
 * country, starting on the tile their map gives them (see installSpawn).
 * They play like bots, at the same pace for the same difficulty (R-BOT-04),
 * but steadier:
 *
 * - under attack, they hold: no order at all until their troops are above
 *   B-NATION-HOLD of their cap, and then only against the attacker, and they
 *   build a fort facing the attacker when their gold allows;
 * - they attack a player only when the odds favour them (B-NATION-ODDS),
 *   or as a bot would once their army is full (B-NATION-FULL), and fight one
 *   player at a time: while an attack of theirs runs against a player, they
 *   open no front against another one. Free land is always fair game, and
 *   the only target during their first B-NATION-GRACE of play.
 *
 * Like bots, they decide from the game state and the game's Random only,
 * and act through game.apply (R-BOT-03).
 */
export function installNations(
  game: Game,
  ids: readonly number[],
  difficulty: BotDifficulty,
  /** B-NATION-GRACE; tests of later behaviour set it to 0. */
  graceSeconds = NATION_GRACE_SECONDS,
): void {
  const { territory, balance } = game;
  const params = BOT_DIFFICULTIES[difficulty];
  const interval = Math.max(1, params.intervalSeconds * balance.ticksPerSecond);
  const retryTicks = RETRY_DECISIONS * interval;
  const graceTicks = graceSeconds * balance.ticksPerSecond;
  const reservePercent = Math.min(100, params.reservePercent + NATION_EXTRA_RESERVE);
  const nations = [...new Set(ids)].sort((a, b) => a - b);
  for (const id of nations) {
    if (!game.player(id)) throw new RangeError(`unknown player ${String(id)}`);
  }
  const seaCooldowns: Cooldowns = new Map();
  const cityCooldowns: Cooldowns = new Map();
  const portCooldowns: Cooldowns = new Map();

  game.onTick(() => {
    if (game.phase !== "play") return;
    for (const id of nations) {
      // Offset by id, like bots, so that decisions spread over the interval.
      if ((game.tick + id) % interval !== 0) continue;
      const nation = game.player(id) as Player;
      if (nation.alive) decide(nation);
    }
  });

  function decide(nation: Player): void {
    const tiles = territory.tileCount(nation.id);
    if (tiles === 0 || territory.borderCount(nation.id) === 0) return;
    buildCity(game, nation, cityCooldowns, retryTicks);
    buildPort(game, nation, portCooldowns, retryTicks);
    const cap = populationCap(game, nation);
    const reserve = percentOf(cap, reservePercent);
    const troops = Math.min(
      percentOf(nation.troops, params.attackRatioPercent),
      nation.troops - reserve,
    );

    const attacker = mainAttacker(nation.id);
    // R-BOT-08: hold the border, and answer the attacker alone once strong enough.
    const front = attacker === NEUTRAL ? -1 : borderWith(nation, attacker);
    if (front >= 0) {
      buildFort(nation, front);
      if (nation.troops * 100 <= cap * NATION_HOLD_PERCENT) return;
      if (troops >= balance.neutralCost) {
        game.apply(nation.id, { type: "attack", target: front, troops });
      }
      return;
    }
    // Less than the price of one tile would come straight back.
    if (troops < balance.neutralCost) return;

    // R-BOT-09: one war at a time. Alliances (#47) will narrow this further.
    const enemies = new Set<number>();
    for (const attack of game.attacks) {
      if (attack.player === nation.id && attack.target !== NEUTRAL) enemies.add(attack.target);
    }
    // R-BOT-09: early on, free land only; an attacker is still answered above (R-BOT-08).
    // So is a nation whose attacker holds no land along its border yet, as when a ship has not landed.
    const settling = game.tick < balance.spawnPhaseTicks + graceTicks || attacker !== NEUTRAL;
    const accept: OwnerFilter | undefined = settling
      ? () => false
      : enemies.size === 0
        ? undefined
        : (owner) => enemies.has(owner);
    const { neutral, enemy, enemyDensity } = scanBorder(game, nation, accept);
    const ownDensity = divFloor(nation.troops, tiles);
    // Troops past the cap would be wasted: a full army takes the odds a bot would.
    const full = nation.troops * 100 >= cap * NATION_FULL_PERCENT;
    const odds = full ? params.boldnessPercent : NATION_ODDS_PERCENT;
    const weak = enemy >= 0 && enemyDensity * 100 <= ownDensity * odds;
    // Free land is cheaper than a fight, unless the neighbour is much weaker.
    const muchWeaker = weak && enemyDensity * 200 <= ownDensity * odds;
    const target = neutral >= 0 && !muchWeaker ? neutral : weak ? enemy : -1;
    if (target >= 0) game.apply(nation.id, { type: "attack", target, troops });
    else sail(game, nation, troops, odds, seaCooldowns, retryTicks, accept);
  }

  /**
   * A tile of `owner` next to the nation's land: from a sample of the border
   * first, then from the whole of it, which only an attack makes worth the cost.
   * -1 when they share no border.
   */
  function borderWith(nation: Player, owner: number): number {
    const { enemy } = scanBorder(game, nation, (other) => other === owner);
    if (enemy >= 0) return enemy;
    const around = new Int32Array(4);
    const topology = game.terrain.topology;
    for (let i = 0; i < territory.borderCount(nation.id); i++) {
      const count = topology.neighborsInto(territory.borderTile(nation.id, i), around);
      for (let j = 0; j < count; j++) {
        const tile = around[j] as number;
        if (territory.ownerOf(tile) === owner) return tile;
      }
    }
    return -1;
  }

  /**
   * The player with the most troops in attacks on the nation's land, or
   * NEUTRAL when nobody's attacks there reach B-NATION-THREAT of its troops:
   * a trickle of small attacks must not keep it from playing.
   */
  function mainAttacker(id: number): number {
    const nation = game.player(id) as Player;
    let attacker = NEUTRAL;
    let most = Math.max(0, percentOf(nation.troops, NATION_THREAT_PERCENT) - 1);
    const byPlayer = new Map<number, number>();
    for (const attack of game.attacks) {
      if (attack.target !== id) continue;
      const total = (byPlayer.get(attack.player) ?? 0) + attack.troops;
      byPlayer.set(attack.player, total);
      // Oldest attack first breaks ties, the same on every client.
      if (total > most) {
        attacker = attack.player;
        most = total;
      }
    }
    return attacker;
  }

  /**
   * R-BOT-08: a fort behind the front with the attacker, on the free inland
   * tile of the nation farthest from the attacker's land within a few tiles,
   * so the first tiles lost do not take it; its radius still covers the front.
   * None while one of its forts, built or being built, already covers it.
   */
  function buildFort(nation: Player, front: number): void {
    const kind = StructureKind.Fort;
    if (nation.gold < structureCost(game, nation.id, kind)) return;
    const topology = game.terrain.topology;
    const radius = fortRadius(game);
    for (const s of game.structures) {
      if (s.kind === kind && s.player === nation.id && topology.distance(s.tile, front) <= radius) {
        return;
      }
    }
    let best = -1;
    let bestDistance = 0;
    for (const tile of topology.tilesWithin(front, Math.min(FORT_SETBACK, radius))) {
      if (territory.ownerOf(tile) !== nation.id || territory.isBorder(tile)) continue;
      const distance = topology.distance(tile, front);
      // Row order breaks ties, the same on every client.
      if (best >= 0 && distance <= bestDistance) continue;
      if (placementError(game, nation, kind, tile) !== undefined) continue;
      best = tile;
      bestDistance = distance;
    }
    if (best >= 0) game.apply(nation.id, { type: "build", structure: kind, tile: best });
  }
}
