import { DOCTRINE_COUNT } from "@frontfall/contracts";
import type { Attack } from "../attacks.ts";
import type { Boat } from "../boats.ts";
import type { Alliance, AllianceRequest, Embargo, RequestCooldown } from "../diplomacy.ts";
import type { CapitalFall, Player } from "../game.ts";
import { MissileSize, type Fallout, type Missile } from "../missiles.ts";
import type { QuickCooldown } from "../quick-messages.ts";
import { StructureKind, type Structure } from "../structures.ts";
import type { TradeShip } from "../trade.ts";
import type { Fight, Warship } from "../warships.ts";
import {
  below,
  flag,
  int,
  onlyIf,
  optionalTile,
  part,
  path,
  player,
  route,
  screen,
  setup,
  tile,
  uint,
  uints,
  type Codec,
} from "./codec.ts";

/*
 * One codec per entity of the state (ADR 0008): the snapshot writes, reads
 * and checks each record from it, field by field in the order of its keys.
 * `satisfies Codec<T>` makes the compiler refuse a codec that misses a field
 * of its entity, or names one it does not have.
 */

/** Structure kinds there are: a snapshot refuses a code past the last. */
const STRUCTURE_KINDS = Object.keys(StructureKind).length;
/** Missile sizes there are. */
const MISSILE_SIZES = Object.keys(MissileSize).length;

/** A player's ledger. Their place in the list is their id: the setup gives the rest. */
export const PLAYER_RECORD = {
  id: setup,
  name: setup,
  // As they are: troops, gold and its remainder are written signed.
  troops: int,
  gold: int,
  goldRemainder: int,
  workShare: below((game) => game.balance.workMaxPercent + 1, "work share"),
  alive: flag("alive"),
  start: optionalTile("start"),
  traitorUntil: uint,
  home: setup,
  team: setup,
  doctrine: onlyIf(
    (game) => game.rules.doctrines,
    below(() => DOCTRINE_COUNT, "doctrine"),
    0,
  ),
  capital: part,
} satisfies Codec<Player>;

export const ATTACK_RECORD = {
  id: uint,
  player,
  target: player,
  aim: tile,
  troops: uint,
  // R-ATTACK-10: a game without collapsing fronts saves as before them.
  pressure: onlyIf((game) => game.rules.collapsingFronts, uint, 0),
} satisfies Codec<Attack>;

export const BOAT_RECORD = {
  id: uint,
  player,
  target: tile,
  troops: uint,
  step: uint,
  path,
} satisfies Codec<Boat>;

export const STRUCTURE_RECORD = {
  id: uint,
  player,
  kind: below<StructureKind>(() => STRUCTURE_KINDS, "structure kind"),
  tile,
  readyAt: uint,
  reloadAt: uint,
} satisfies Codec<Structure>;

export const TRADE_SHIP_RECORD = {
  id: uint,
  player,
  port: uint,
  from: tile,
  to: tile,
  step: uint,
  path: route,
} satisfies Codec<TradeShip>;

export const WARSHIP_RECORD = {
  id: uint,
  player,
  tile,
  health: uint,
  patrol: tile,
  step: uint,
  reloadAt: uint,
  path,
  firedAt: screen,
  aim: screen,
} satisfies Codec<Warship>;

export const MISSILE_RECORD = {
  id: uint,
  player,
  size: below<MissileSize>(() => MISSILE_SIZES, "missile size"),
  from: tile,
  to: tile,
  launchedAt: uint,
  arrivesAt: uint,
  tried: uints,
} satisfies Codec<Missile>;

export const FALLOUT_RECORD = {
  tile,
  radius: uint,
  until: uint,
} satisfies Codec<Fallout>;

export const FIGHT_RECORD = { a: player, b: player, until: uint } satisfies Codec<Fight>;

export const ALLIANCE_RECORD = {
  a: player,
  b: player,
  until: uint,
  renewA: flag("renewal"),
  renewB: flag("renewal"),
  truce: flag("truce"),
} satisfies Codec<Alliance>;

export const ALLIANCE_REQUEST_RECORD = {
  from: player,
  to: player,
  expiresAt: uint,
} satisfies Codec<AllianceRequest>;

export const REQUEST_COOLDOWN_RECORD = {
  from: player,
  to: player,
  until: uint,
} satisfies Codec<RequestCooldown>;

export const EMBARGO_RECORD = {
  from: player,
  to: player,
  since: uint,
  until: uint,
} satisfies Codec<Embargo>;

export const QUICK_COOLDOWN_RECORD = {
  player,
  until: uint,
} satisfies Codec<QuickCooldown>;

/** Saved by the capitals part, which never checked their range: neither does its codec. */
export const CAPITAL_FALL_RECORD = {
  tick: uint,
  player: uint,
  by: uint,
  tile: uint,
} satisfies Codec<CapitalFall>;
