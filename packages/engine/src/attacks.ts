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

/**
 * Expansion and attacks (R-ATTACK-01 to R-ATTACK-07). Troops leave the player
 * when the attack starts, take tiles along the shared border each tick, and
 * whatever is left returns to the player when the attack ends. Attacks under
 * way live in `game.attacks`.
 */
export function installAttacks(game: Game): void {
  const { territory, terrain, balance } = game;
  const topology = terrain.topology;
  const attacks = game.attacks;

  // Scratch space reused every tick: tiles already listed as candidates in the current scan.
  const seen = new Uint32Array(topology.size);
  let scan = 0;
  const around = new Int32Array(4);
  const pocketFill = new BoundedFloodFill(topology);
  const nextToCapture = new Int32Array(4);
  // Defender tiles already found in an open or oversized region during the current check.
  const examined = new Uint32Array(topology.size);
  let examination = 0;
  const captured: number[] = [];

  // Each attack's front for the current tick: tiles to take, closest to its aim first.
  const fronts: number[][] = [];
  const frontDistances: number[][] = [];
  const speeds: number[] = [];
  const attacksOf = new Map<number, number[]>();

  /**
   * Plans every attack's front for this tick before any of them moves: up to
   * its speed in tiles of its target that touch the player's territory, the
   * closest to its aim first. One pass over each attacking player's border
   * serves all of their attacks, and only the best few tiles are kept, so a
   * long front costs one scan and no sort.
   */
  function planFronts(): void {
    attacksOf.clear();
    for (let a = 0; a < attacks.length; a++) {
      const attack = attacks[a] as Attack;
      (fronts[a] ??= []).length = 0;
      (frontDistances[a] ??= []).length = 0;
      const alive = game.player(attack.player)?.alive === true;
      speeds[a] =
        alive && attack.troops > 0
          ? 1 + divFloor(isqrt(attack.troops), balance.attackSpeedDivisor)
          : 0;
      if (speeds[a] === 0) continue;
      const own = attacksOf.get(attack.player);
      if (own) own.push(a);
      else attacksOf.set(attack.player, [a]);
    }
    // Map iteration follows insertion, which follows the attack list: the same on every client.
    for (const [player, own] of attacksOf) {
      scan++;
      const borders = territory.borderCount(player);
      for (let i = 0; i < borders; i++) {
        const count = topology.neighborsInto(territory.borderTile(player, i), around);
        for (let j = 0; j < count; j++) {
          const tile = around[j] as number;
          if (seen[tile] === scan) continue;
          const owner = territory.ownerOf(tile);
          if (owner === player || !terrain.isOwnable(tile)) continue;
          const a = own.find((index) => (attacks[index] as Attack).target === owner);
          if (a === undefined) continue;
          seen[tile] = scan;
          shortlist(a, tile, topology.distance(tile, (attacks[a] as Attack).aim));
        }
      }
    }
  }

  /** Inserts a tile into an attack's front, kept sorted by distance then tile and cut at its speed. */
  function shortlist(a: number, tile: number, distance: number): void {
    const tiles = fronts[a] as number[];
    const distances = frontDistances[a] as number[];
    const limit = speeds[a] as number;
    let at = tiles.length;
    while (
      at > 0 &&
      ((distances[at - 1] as number) > distance ||
        ((distances[at - 1] as number) === distance && (tiles[at - 1] as number) > tile))
    ) {
      at--;
    }
    if (at >= limit) return;
    tiles.splice(at, 0, tile);
    distances.splice(at, 0, distance);
    if (tiles.length > limit) {
      tiles.pop();
      distances.pop();
    }
  }

  /** Whether any land of `target` touches the player's territory. */
  function touches(player: number, target: number): boolean {
    const borders = territory.borderCount(player);
    for (let i = 0; i < borders; i++) {
      const count = topology.neighborsInto(territory.borderTile(player, i), around);
      for (let j = 0; j < count; j++) {
        const tile = around[j] as number;
        if (territory.ownerOf(tile) === target && terrain.isOwnable(tile)) return true;
      }
    }
    return false;
  }

  const tileCost = (tile: number, defender: Player | undefined): number =>
    captureCost(game, tile, defender);
  const defenderDensity = (defender: Player): number => troopsPerTile(game, defender);

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
      id: game.nextAttackId,
      player: player.id,
      target,
      aim: order.target,
      troops: 0,
    };
    // R-ATTACK-09: without a shared border, only ships can reach the target.
    if (!touches(player.id, target)) return false;
    player.troops -= order.troops;
    attack.troops += order.troops;
    attack.aim = order.target;
    if (!existing) {
      attacks.push(attack);
      game.nextAttackId++;
    }
    return true;
  });

  game.onTick(() => {
    if (game.phase !== "play") return;
    cancelOpposingAttacks(attacks);
    planFronts();
    for (let a = 0; a < attacks.length; a++) advance(attacks[a] as Attack, fronts[a] as number[]);
    // Troops of a finished attack went back to its player in finish(); a fallen player's are lost.
    for (let i = attacks.length - 1; i >= 0; i--) {
      const attack = attacks[i] as Attack;
      if (attack.troops <= 0 || !game.player(attack.player)?.alive) attacks.splice(i, 1);
    }
  });

  /** Takes the tiles planned for this tick; an attack that cannot go on is marked done. */
  function advance(attack: Attack, tiles: readonly number[]): void {
    const attacker = game.player(attack.player);
    const defender = attack.target === NEUTRAL ? undefined : game.player(attack.target);
    if (!attacker?.alive || attack.troops <= 0) return;
    if (tiles.length === 0) {
      finish(attack);
      return;
    }
    captured.length = 0;
    for (const tile of tiles) {
      // Another attack, or an encirclement, may have taken it earlier in the tick.
      if (territory.ownerOf(tile) !== attack.target) continue;
      const cost = tileCost(tile, defender);
      if (attack.troops < cost) {
        finish(attack);
        break;
      }
      attack.troops -= cost;
      if (defender) defender.troops -= Math.min(defender.troops, defenderDensity(defender));
      territory.setOwner(tile, attack.player);
      captured.push(tile);
    }
    captureEnclosedPockets(attack.player);
  }

  /**
   * R-ATTACK-08: once an attack has taken this tick's tiles, any piece of
   * another player's land next to them that is now enclosed by the attacker
   * alone goes to the attacker, whoever the attack was aimed at. A region
   * found open, or too large, is not walked again for the other tiles of the
   * same tick: a long front costs one fill per region, not one per tile.
   */
  function captureEnclosedPockets(attacker: number): void {
    examination++;
    for (const tile of captured) {
      const count = topology.neighborsInto(tile, nextToCapture);
      for (let i = 0; i < count; i++) {
        const start = nextToCapture[i] as number;
        const defender = territory.ownerOf(start);
        if (defender === attacker || defender === NEUTRAL) continue;
        if (examined[start] === examination) continue;
        const size = pocketFill.fill(
          start,
          (candidate) => {
            const owner = territory.ownerOf(candidate);
            if (owner === defender) {
              if (examined[candidate] !== examination) return true;
              pocketFill.stop(); // joins a region already known to be open
              return false;
            }
            // Any land not held by the attacker means the region still has a way out.
            if (owner !== attacker && terrain.isOwnable(candidate)) pocketFill.stop();
            return false;
          },
          balance.encircleMaxTiles,
        );
        if (size > 0) {
          for (const pocket of pocketFill.tiles()) territory.setOwner(pocket, attacker);
        } else {
          for (const open of pocketFill.reached()) examined[open] = examination;
        }
      }
    }
  }

  /** Ends an attack at the next sweep, returning its troops to the player. */
  function finish(attack: Attack): void {
    const player = game.player(attack.player);
    if (player?.alive) player.troops += attack.troops;
    attack.troops = 0;
  }
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

/** Troops it costs to take one tile (R-ATTACK-03, R-ATTACK-04, R-MAP-06). */
export function captureCost(game: Game, tile: number, defender: Player | undefined): number {
  const { balance, terrain } = game;
  const kind = terrain.kind(tile);
  const relief =
    balance.reliefCostTenths[kind === TileKind.Mountains ? 2 : kind === TileKind.Hills ? 1 : 0];
  const density = defender ? troopsPerTile(game, defender) : 0;
  const base = balance.neutralCost + mulDiv(density, balance.defenseDensityTenths, 10);
  return Math.max(1, mulDiv(base, relief, 10));
}

/** A defender's troops spread over their land: what they lose with each tile taken. */
export function troopsPerTile(game: Game, defender: Player): number {
  const tiles = game.territory.tileCount(defender.id);
  return tiles === 0 ? 0 : divFloor(defender.troops, tiles);
}
