import type { Game, Player } from "./game.ts";
import { percentOf } from "./integer-math.ts";

/** Two players at peace until `until` (R-DIPLO-02, R-DIPLO-03). `a` is always the lower id. */
export interface Alliance {
  readonly a: number;
  readonly b: number;
  /** First tick the alliance no longer holds. */
  until: number;
  /** Whether each side asked to renew in the last part of the alliance. */
  renewA: boolean;
  renewB: boolean;
}

/** An alliance asked for and not answered yet (R-DIPLO-01). */
export interface AllianceRequest {
  readonly from: number;
  readonly to: number;
  /** First tick the request is gone. */
  readonly expiresAt: number;
}

/** A player who may not ask the same player again before `until` (R-DIPLO-01). */
export interface RequestCooldown {
  readonly from: number;
  readonly to: number;
  readonly until: number;
}

/** Refusals of diplomacy orders, so that interfaces can tell them apart without parsing text. */
export const DiplomacyError = {
  Early: "diplomacy starts after the spawn phase",
  Player: "no such player in the game",
  Self: "a player cannot ally with themselves",
  Asked: "an alliance request is already waiting",
  Cooldown: "too soon to ask this player again",
  Allied: "already allied",
  Renewal: "the alliance cannot be renewed yet",
  NotAllied: "not allied with this player",
  Ally: "the tile belongs to an ally",
} as const;

export type DiplomacyError = (typeof DiplomacyError)[keyof typeof DiplomacyError];

export function isAllied(game: Game, a: number, b: number): boolean {
  return allianceOf(game, a, b) !== undefined;
}

export function allianceOf(game: Game, a: number, b: number): Alliance | undefined {
  if (a === b) return undefined;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return game.alliances.find(
    (alliance) => alliance.a === low && alliance.b === high && game.tick < alliance.until,
  );
}

/** Ids of a player's allies, in ascending order. */
export function alliesOf(game: Game, player: number): number[] {
  const allies: number[] = [];
  for (const { a, b, until } of game.alliances) {
    if (game.tick >= until) continue;
    if (a === player) allies.push(b);
    else if (b === player) allies.push(a);
  }
  return allies.sort((x, y) => x - y);
}

export function requestBetween(game: Game, from: number, to: number): AllianceRequest | undefined {
  return game.allianceRequests.find(
    (request) => request.from === from && request.to === to && game.tick < request.expiresAt,
  );
}

/** R-DIPLO-04: a player who broke an alliance defends worse until the mark wears off. */
export function isTraitor(game: Game, player: Player): boolean {
  return game.tick < player.traitorUntil;
}

/** Whether a renewal may be asked for now: in the last part of the alliance (R-DIPLO-03). */
export function canRenew(game: Game, alliance: Alliance): boolean {
  return alliance.until - game.tick <= game.balance.allianceRenewTicks;
}

/** Why `player` cannot send `ally` to `target` now, or undefined. */
export function allyError(game: Game, player: Player, target: number): string | undefined {
  if (game.phase !== "play") return DiplomacyError.Early;
  if (target === player.id) return DiplomacyError.Self;
  if (!game.player(target)?.alive) return DiplomacyError.Player;
  const alliance = allianceOf(game, player.id, target);
  if (alliance) {
    const voted = player.id === alliance.a ? alliance.renewA : alliance.renewB;
    return canRenew(game, alliance) && !voted ? undefined : DiplomacyError.Renewal;
  }
  // Answering the other side's request is always allowed.
  if (requestBetween(game, target, player.id)) return undefined;
  if (requestBetween(game, player.id, target)) return DiplomacyError.Asked;
  // A request that ran out this tick has not turned into a cooldown yet.
  const lapsed = game.allianceRequests.some(
    (r) => r.from === player.id && r.to === target && game.tick >= r.expiresAt,
  );
  const waiting =
    lapsed ||
    game.requestCooldowns.some(
      (c) => c.from === player.id && c.to === target && game.tick < c.until,
    );
  return waiting ? DiplomacyError.Cooldown : undefined;
}

/** Why `player` cannot betray `target` now, or undefined. */
export function betrayError(game: Game, player: Player, target: number): string | undefined {
  if (game.phase !== "play") return DiplomacyError.Early;
  if (!game.player(target)?.alive) return DiplomacyError.Player;
  return isAllied(game, player.id, target) ? undefined : DiplomacyError.NotAllied;
}

/**
 * Diplomacy (R-DIPLO-01 to R-DIPLO-04). `ally` asks for an alliance, accepts
 * the other side's request, or votes to renew a running alliance; `betray`
 * ends one at once and marks the player who broke it. Requests, alliances and
 * cooldowns run out on ticks, so every client drops them at the same moment.
 * Queries ignore what has run out, so the rules that run later in the tick
 * agree with the orders of the tick; the lists drop it at the end of that tick.
 */
export function installDiplomacy(game: Game): void {
  const { balance } = game;

  game.onOrder((_, player, order) => {
    if (order.type !== "ally") return false;
    const target = order.target;
    const alliance = allianceOf(game, player.id, target);
    if (alliance) {
      if (player.id === alliance.a) alliance.renewA = true;
      else alliance.renewB = true;
      if (alliance.renewA && alliance.renewB) {
        alliance.until = game.tick + balance.allianceTicks;
        alliance.renewA = false;
        alliance.renewB = false;
      }
      return true;
    }
    const asked = requestBetween(game, target, player.id);
    if (!asked) {
      game.allianceRequests.push({
        from: player.id,
        to: target,
        expiresAt: game.tick + balance.allianceRequestTicks,
      });
      return true;
    }
    removeWhere(game.allianceRequests, (r) => r === asked);
    form(player.id, target);
    return true;
  });

  game.onOrder((_, player, order) => {
    if (order.type !== "betray") return false;
    const broken = allianceOf(game, player.id, order.target);
    removeWhere(game.alliances, (a) => a === broken);
    player.traitorUntil = game.tick + balance.traitorTicks;
    // No asking the betrayed player straight back.
    game.requestCooldowns.push({
      from: player.id,
      to: order.target,
      until: game.tick + balance.allianceCooldownTicks,
    });
    return true;
  });

  game.onTick(() => {
    const tick = game.tick;
    const alive = (id: number) => game.player(id)?.alive === true;
    for (const request of game.allianceRequests) {
      if (tick < request.expiresAt || !alive(request.from) || !alive(request.to)) continue;
      game.requestCooldowns.push({
        from: request.from,
        to: request.to,
        until: request.expiresAt + balance.allianceCooldownTicks,
      });
    }
    removeWhere(
      game.allianceRequests,
      (r) => tick >= r.expiresAt || !alive(r.from) || !alive(r.to),
    );
    removeWhere(game.alliances, (a) => tick >= a.until || !alive(a.a) || !alive(a.b));
    removeWhere(game.requestCooldowns, (c) => tick >= c.until);
  });

  /** R-DIPLO-02: the new allies' attacks on each other end, and their troops go home as from a retreat. */
  function form(first: number, second: number): void {
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    removeWhere(
      game.allianceRequests,
      (r) => (r.from === high && r.to === low) || (r.from === low && r.to === high),
    );
    game.alliances.push({
      a: low,
      b: high,
      until: game.tick + balance.allianceTicks,
      renewA: false,
      renewB: false,
    });
    game.alliances.sort((x, y) => x.a - y.a || x.b - y.b);
    for (const attack of game.attacks) {
      const against =
        (attack.player === low && attack.target === high) ||
        (attack.player === high && attack.target === low);
      if (!against || attack.troops <= 0) continue;
      const owner = game.player(attack.player);
      if (owner)
        owner.troops += attack.troops - percentOf(attack.troops, balance.retreatPenaltyPercent);
      attack.troops = 0;
    }
  }
}

function removeWhere<T>(list: T[], drop: (item: T) => boolean): void {
  let kept = 0;
  for (const item of list) if (!drop(item)) list[kept++] = item;
  list.length = kept;
}
