import type { Game, Player } from "./game.ts";
import { divFloor, isqrt, mulDiv, percentOf } from "./integer-math.ts";
import { TileKind } from "./terrain.ts";
import { BoundedFloodFill } from "./territory/bounded-flood-fill.ts";
import { NEUTRAL } from "./territory/territory-map.ts";

/** A wave of troops pushing into the land of one opponent, or into unowned land. */
export interface Attack {
  readonly id: number;
  readonly player: number;
  /** Owner of the land under attack: a player id, or NEUTRAL. */
  readonly target: number;
  /** Tile the player aimed at; the front advances towards it first. */
  aim: number;
  troops: number;
}

export interface Attacks {
  /** Attacks under way, oldest first. */
  list(): readonly Readonly<Attack>[];
}

/**
 * Expansion and attacks (R-ATTACK-01 to R-ATTACK-07). Troops leave the player
 * when the attack starts, take tiles along the shared border each tick, and
 * whatever is left returns to the player when the attack ends.
 */
export function installAttacks(game: Game): Attacks {
  const { territory, terrain, balance } = game;
  const topology = terrain.topology;
  let attacks: Attack[] = [];
  let nextId = 1;

  // Scratch space reused every tick: tiles already listed as candidates in the current scan.
  const seen = new Uint32Array(topology.size);
  let scan = 0;
  const around = new Int32Array(4);
  const pocketFill = new BoundedFloodFill(topology);
  const nextToCapture = new Int32Array(4);

  /** Tiles of `target` that touch the player's territory, best first. */
  function frontline(attack: Attack, limit: number): number[] {
    scan++;
    const found: { tile: number; distance: number }[] = [];
    const borders = territory.borderCount(attack.player);
    for (let i = 0; i < borders; i++) {
      const count = topology.neighborsInto(territory.borderTile(attack.player, i), around);
      for (let j = 0; j < count; j++) {
        const tile = around[j] as number;
        if (seen[tile] === scan || territory.ownerOf(tile) !== attack.target) continue;
        if (!terrain.isOwnable(tile)) continue;
        seen[tile] = scan;
        found.push({ tile, distance: topology.distance(tile, attack.aim) });
      }
    }
    found.sort((a, b) => a.distance - b.distance || a.tile - b.tile);
    return found.slice(0, limit).map((candidate) => candidate.tile);
  }

  /** Troops it costs to take one tile (R-ATTACK-03, R-ATTACK-04, R-MAP-06). */
  function tileCost(tile: number, defender: Player | undefined): number {
    const kind = terrain.kind(tile);
    const relief =
      balance.reliefCostTenths[kind === TileKind.Mountains ? 2 : kind === TileKind.Hills ? 1 : 0];
    const density = defender ? defenderDensity(defender) : 0;
    const base = balance.neutralCost + mulDiv(density, balance.defenseDensityTenths, 10);
    return Math.max(1, mulDiv(base, relief, 10));
  }

  function defenderDensity(defender: Player): number {
    const tiles = territory.tileCount(defender.id);
    return tiles === 0 ? 0 : divFloor(defender.troops, tiles);
  }

  // R-ATTACK-06: a player calls back one of their own attacks, losing part of its troops.
  game.onOrder((_, player, order) => {
    if (order.type !== "retreat") return false;
    const attack = attacks.find((a) => a.id === order.attack && a.player === player.id);
    if (!attack || attack.troops <= 0) return false;
    player.troops += attack.troops - percentOf(attack.troops, balance.retreatPenaltyPercent);
    attack.troops = 0;
    return true;
  });

  game.onOrder((_, player, order) => {
    if (order.type !== "attack") return false;
    const target = territory.ownerOf(order.target);
    if (target !== NEUTRAL && !game.player(target)?.alive) return false;
    const existing = attacks.find((a) => a.player === player.id && a.target === target);
    const attack = existing ?? {
      id: nextId,
      player: player.id,
      target,
      aim: order.target,
      troops: 0,
    };
    // R-ATTACK-09: without a shared border, only ships can reach the target.
    if (frontline({ ...attack, aim: order.target }, 1).length === 0) return false;
    player.troops -= order.troops;
    attack.troops += order.troops;
    attack.aim = order.target;
    if (!existing) {
      attacks.push(attack);
      nextId++;
    }
    return true;
  });

  game.onTick(() => {
    if (game.phase !== "play") return;
    cancelOpposingAttacks(attacks);
    for (const attack of attacks) advance(attack);
    // Troops of a finished attack went back to its player in finish(); a fallen player's are lost.
    attacks = attacks.filter((attack) => attack.troops > 0 && game.player(attack.player)?.alive);
  });

  /** Takes up to the attack's speed in tiles; an attack that cannot go on is marked done. */
  function advance(attack: Attack): void {
    const attacker = game.player(attack.player);
    const defender = attack.target === NEUTRAL ? undefined : game.player(attack.target);
    if (!attacker?.alive || attack.troops <= 0) return;
    const speed = 1 + divFloor(isqrt(attack.troops), balance.attackSpeedDivisor);
    const tiles = frontline(attack, speed);
    if (tiles.length === 0) {
      finish(attack);
      return;
    }
    for (const tile of tiles) {
      const cost = tileCost(tile, defender);
      if (attack.troops < cost) {
        finish(attack);
        return;
      }
      attack.troops -= cost;
      if (defender) defender.troops -= Math.min(defender.troops, defenderDensity(defender));
      territory.setOwner(tile, attack.player);
      if (defender) captureEnclosedPockets(tile, attack.player, defender.id);
    }
  }

  /**
   * R-ATTACK-08: after `tile` changes hands, any piece of the defender's land
   * next to it that is now enclosed by the attacker alone goes to the attacker.
   */
  function captureEnclosedPockets(tile: number, attacker: number, defender: number): void {
    const count = topology.neighborsInto(tile, nextToCapture);
    for (let i = 0; i < count; i++) {
      const start = nextToCapture[i] as number;
      if (territory.ownerOf(start) !== defender) continue;
      const pocket = { open: false };
      const size = pocketFill.fill(
        start,
        (candidate) => {
          const owner = territory.ownerOf(candidate);
          if (owner === defender) return true;
          // Any land not held by the attacker means the pocket still has a way out.
          if (owner !== attacker && terrain.isOwnable(candidate)) pocket.open = true;
          return false;
        },
        balance.encircleMaxTiles,
      );
      if (pocket.open || size <= 0) continue;
      for (const captured of Array.from(pocketFill.tiles())) territory.setOwner(captured, attacker);
    }
  }

  /** Ends an attack at the next sweep, returning its troops to the player. */
  function finish(attack: Attack): void {
    const player = game.player(attack.player);
    if (player?.alive) player.troops += attack.troops;
    attack.troops = 0;
  }

  return { list: () => attacks };
}

/** R-ATTACK-07: two attacks between the same players in opposite directions fight each other first. */
function cancelOpposingAttacks(attacks: Attack[]): void {
  for (const attack of attacks) {
    if (attack.target === NEUTRAL || attack.troops <= 0) continue;
    const opposing = attacks.find(
      (other) =>
        other.player === attack.target && other.target === attack.player && other.troops > 0,
    );
    if (!opposing) continue;
    const clash = Math.min(attack.troops, opposing.troops);
    attack.troops -= clash;
    opposing.troops -= clash;
  }
}
