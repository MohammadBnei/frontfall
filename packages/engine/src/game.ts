import type { Attack } from "./attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "./balance.ts";
import type { Boat } from "./boats.ts";
import type {
  Alliance,
  AllianceRequest,
  DiplomacyEvent,
  Embargo,
  RequestCooldown,
} from "./diplomacy.ts";
import type { Fallout, Missile } from "./missiles.ts";
import { orderError } from "./orders.ts";
import { Random } from "./random.ts";
import type { Structure } from "./structures.ts";
import type { Terrain } from "./terrain.ts";
import type { TradeShip } from "./trade.ts";
import type { Fight, Warship } from "./warships.ts";
import { MAX_PLAYER_ID, TerritoryMap } from "./territory/territory-map.ts";

/** An order from a player, as relayed by the server in a turn. */
export type Order =
  | { type: "spawn"; tile: number }
  | { type: "attack"; target: number; troops: number }
  | { type: "retreat"; attack: number }
  | { type: "embark"; target: number; troops: number }
  /** `structure` is a StructureKind code. */
  | { type: "build"; structure: number; tile: number }
  | { type: "demolish"; tile: number }
  /** `target` is a player id. */
  | { type: "ally"; target: number }
  | { type: "betray"; target: number }
  /** `on`: 1 starts an embargo on player `target`, 0 lifts it. */
  | { type: "embargo"; target: number; on: number }
  /** Buys a warship at the player's port on tile `port`. */
  | { type: "warship"; port: number }
  /** Sends warship `ship` to patrol around water tile `tile`. */
  | { type: "patrol"; ship: number; tile: number }
  /** Launches a missile of `size` (a MissileSize code) at tile `target`. */
  | { type: "missile"; target: number; size: number }
  /** Sends player `target` troops and gold (R-DIPLO-06); either may be 0. */
  | { type: "gift"; target: number; troops: number; gold: number }
  /** Sends player `target` the preset quick message `phrase` (R-DIPLO-07). */
  | { type: "quick"; target: number; phrase: number };

/** Every order accepted during one tick, in the order the server accepted them (R-FAIR-03). */
export interface Turn {
  tick: number;
  orders: readonly { player: number; order: Order }[];
}

export interface PlayerSetup {
  /** 1 to MAX_PLAYER_ID; 0 is the neutral owner. */
  id: number;
  name: string;
  /** Start tile set by the map, for a nation (R-BOT-07); others pick or are placed. */
  start?: number;
}

export interface GameSetup {
  terrain: Terrain;
  seed: number;
  players: readonly PlayerSetup[];
  balance?: Balance;
  /**
   * Teams of the game (R-MODE-02): 2, 3 or 4, dealt in turn to the players
   * in id order; 0 or left out for a free-for-all.
   */
  teams?: number;
  /** What this game leaves out (R-MODE-03), as `Disable` bits; 0 or left out for nothing. */
  disabled?: number;
}

/**
 * What a private game can leave out (R-MODE-03), one bit each: a structure
 * by its StructureKind code (bit `1 << kind`), and warships. A palace has no
 * bit of its own and goes with the cities: ask `disableBit` for a kind's bit.
 */
export const Disable = {
  City: 1 << 0,
  Fort: 1 << 1,
  Port: 1 << 2,
  Silo: 1 << 3,
  AirDefense: 1 << 4,
  Warships: 1 << 5,
} as const;
/** Every `Disable` bit. */
export const DISABLE_ALL = 0x3f;

/** What a game leaves out once its implications are added: warships are launched from ports (R-MODE-03). */
export function leftOut(disabled: number): number {
  return disabled & Disable.Port ? disabled | Disable.Warships : disabled;
}

export interface Player {
  readonly id: number;
  readonly name: string;
  troops: number;
  gold: number;
  /** Fraction of a gold coin earned but not yet paid, in units of the economy's divisor. */
  goldRemainder: number;
  alive: boolean;
  /** Start tile, once picked or placed during the spawn phase. */
  start: number | undefined;
  /** First tick the player is no longer marked a traitor (R-DIPLO-04); 0 if never. */
  traitorUntil: number;
  /** Start tile the map sets for a nation (R-BOT-07); undefined for players who pick. */
  readonly home: number | undefined;
  /** Team from 1, or 0 in a free-for-all (R-MODE-02). */
  readonly team: number;
}

export type Phase = "spawn" | "play";

/** Most teams a game can have (R-MODE-02). */
export const MAX_TEAMS = 4;

/**
 * Carries out one order that passed validation. Returns false when the order
 * is not for this handler, or cannot be carried out after all.
 */
export type OrderHandler = (game: Game, player: Player, order: Order) => boolean;

/** Runs once per tick, after the orders of that tick, in registration order. */
export type TickSystem = (game: Game) => void;

/**
 * The whole state of one game and the loop that advances it. Given the same
 * setup and the same turns, every runtime reaches the same state (ADR 0001).
 */
export class Game {
  readonly terrain: Terrain;
  readonly territory: TerritoryMap;
  readonly random: Random;
  /** Seed of the game, for draws derived from it (`derivedRandom`). */
  readonly seed: number;
  readonly balance: Balance;
  /** Attacks under way, oldest first. Owned by the attack rules; read only elsewhere. */
  readonly attacks: Attack[] = [];
  nextAttackId = 1;
  /** Transport ships at sea, oldest first. Owned by the boat rules; read only elsewhere. */
  readonly boats: Boat[] = [];
  nextBoatId = 1;
  /** Structures on the map, oldest first. Owned by the structure rules; read only elsewhere. */
  readonly structures: Structure[] = [];
  nextStructureId = 1;
  /** Trade ships at sea, oldest first. Owned by the trade rules; read only elsewhere. */
  readonly tradeShips: TradeShip[] = [];
  nextTradeShipId = 1;
  /** Warships, oldest first. Owned by the warship rules; read only elsewhere. */
  readonly warships: Warship[] = [];
  nextWarshipId = 1;
  /** Missiles in flight, oldest first. Owned by the missile rules; read only elsewhere. */
  readonly missiles: Missile[] = [];
  nextMissileId = 1;
  /** Fallout of heavy missiles still on the land, oldest first (R-UNIT-06). */
  readonly fallout: Fallout[] = [];
  /**
   * First tick each tile is free of fallout again; 0 if it never had any.
   * It follows from `fallout`, which the state hash covers.
   */
  readonly falloutUntil: Uint32Array;
  /** Fights between players, remembered for B-WAR-MEMORY, by ascending pair of ids. */
  readonly fights: Fight[] = [];
  /** Alliances by ascending pair of ids. Owned by the diplomacy rules; read only elsewhere. */
  readonly alliances: Alliance[] = [];
  /** Alliance requests waiting for an answer, oldest first. */
  readonly allianceRequests: AllianceRequest[] = [];
  /** Players who may not ask a given player again yet, oldest first. */
  readonly requestCooldowns: RequestCooldown[] = [];
  /** Embargoes, oldest first (R-DIPLO-05). */
  readonly embargoes: Embargo[] = [];
  /** Players waiting to send another quick message (R-DIPLO-07), by player id. */
  readonly quickCooldowns: { readonly player: number; readonly until: number }[] = [];
  /**
   * What happened between players, oldest first, for interfaces to read and
   * empty. No rule reads it back, so it is not part of the state hash.
   */
  readonly diplomacyEvents: DiplomacyEvent[] = [];
  /** Number of teams, 0 in a free-for-all (R-MODE-02). */
  readonly teams: number;
  /** `Disable` bits of what this game leaves out (R-MODE-03). */
  readonly disabled: number;
  /**
   * Winner once the game is decided (R-WIN), and the tick it happened. In a
   * team game, the member of the winning team with the most land.
   */
  winner: number | undefined;
  /** In a team game, the team that won. */
  winningTeam: number | undefined;
  decidedAt: number | undefined;
  private readonly playersById = new Map<number, Player>();
  private readonly sortedPlayers: readonly Player[];
  private readonly handlers: OrderHandler[] = [];
  private readonly systems: TickSystem[] = [];
  private currentTick = 0;
  /** The balance values, folded once into the state hash: clients that disagree on them part at once. */
  private readonly balanceDigest: number;

  constructor(setup: GameSetup) {
    this.terrain = setup.terrain;
    this.random = new Random(setup.seed);
    this.seed = setup.seed >>> 0;
    this.balance = setup.balance ?? DEFAULT_BALANCE;
    checkBalance(this.balance);
    this.balanceDigest = digestBalance(this.balance);
    let highest = 1;
    for (const { id, name, start: home } of setup.players) {
      if (!Number.isInteger(id) || id < 1 || id > MAX_PLAYER_ID) {
        throw new RangeError(`invalid player id ${String(id)}`);
      }
      if (this.playersById.has(id)) throw new RangeError(`duplicate player id ${String(id)}`);
      if (
        home !== undefined &&
        !(Number.isInteger(home) && home >= 0 && home < setup.terrain.topology.size)
      ) {
        throw new RangeError(`start of player ${String(id)} is off the map`);
      }
      this.playersById.set(id, {
        id,
        name,
        troops: 0,
        gold: 0,
        goldRemainder: 0,
        alive: true,
        start: undefined,
        traitorUntil: 0,
        home,
        team: 0,
      });
      highest = Math.max(highest, id);
    }
    const teams = setup.teams ?? 0;
    if (teams !== 0 && !(Number.isInteger(teams) && teams >= 2 && teams <= MAX_TEAMS)) {
      throw new RangeError(`invalid number of teams ${String(teams)}`);
    }
    this.teams = teams;
    const disabled = setup.disabled ?? 0;
    if (!(Number.isInteger(disabled) && disabled >= 0 && disabled <= DISABLE_ALL)) {
      throw new RangeError(`invalid disabled set ${String(disabled)}`);
    }
    this.disabled = leftOut(disabled);
    // R-MODE-02: dealt in turn, so team sizes differ by one at most.
    this.sortedPlayers = [...this.playersById.values()]
      .sort((a, b) => a.id - b.id)
      .map((player, i) => (teams === 0 ? player : { ...player, team: (i % teams) + 1 }));
    for (const player of this.sortedPlayers) this.playersById.set(player.id, player);
    this.territory = new TerritoryMap(setup.terrain.topology, highest);
    this.falloutUntil = new Uint32Array(setup.terrain.topology.size);
  }

  /** Number of the next tick to run; also the number of ticks run so far. */
  get tick(): number {
    return this.currentTick;
  }

  get phase(): Phase {
    return this.currentTick < this.balance.spawnPhaseTicks ? "spawn" : "play";
  }

  /** Whether a tile can be taken now: ownable land with no fallout on it (R-UNIT-06). */
  usable(tile: number): boolean {
    return this.terrain.isOwnable(tile) && (this.falloutUntil[tile] as number) <= this.currentTick;
  }

  /** Whether this game has what a `Disable` bit stands for (R-MODE-03). */
  allows(feature: number): boolean {
    return (this.disabled & feature) === 0;
  }

  player(id: number): Player | undefined {
    return this.playersById.get(id);
  }

  /** Players in ascending id order, so iteration is the same everywhere. */
  players(): readonly Player[] {
    return this.sortedPlayers;
  }

  /**
   * 32-bit FNV-1a hash of the whole game state. Two clients that ran the same
   * turns must report the same hash for the same tick (R-FAIR-01).
   */
  hash(): number {
    let hash = 0x811c9dc5;
    const mixWord = (word: number): void => {
      for (let shift = 0; shift < 32; shift += 8) {
        hash = Math.imul(hash ^ ((word >>> shift) & 0xff), 0x01000193);
      }
    };
    // Feeds the value as two 32-bit halves, so counts above 2^32 are not truncated.
    const mix = (value: number): void => {
      mixWord(value >>> 0);
      mixWord(Math.floor(value / 2 ** 32) >>> 0);
    };
    mix(this.currentTick);
    mixWord(this.balanceDigest);
    for (const word of this.random.state()) mix(word);
    const owners = this.territory.owners;
    for (let tile = 0; tile < owners.length; tile++) {
      hash = Math.imul(hash ^ (owners[tile] as number), 0x01000193);
    }
    for (const p of this.sortedPlayers) {
      for (const value of [
        p.id,
        p.troops,
        p.gold,
        p.goldRemainder,
        p.alive ? 1 : 0,
        p.start ?? -1,
        p.traitorUntil,
        // The map's nations come from its manifest, which the terrain's hash does not cover.
        p.home ?? -1,
      ]) {
        mix(value);
      }
    }
    mix(this.nextAttackId);
    for (const a of this.attacks)
      for (const value of [a.id, a.player, a.target, a.aim, a.troops]) mix(value);
    mix(this.nextBoatId);
    for (const b of this.boats) {
      for (const value of [b.id, b.player, b.target, b.troops, b.step, b.path.length]) mix(value);
      for (const tile of b.path) mix(tile);
    }
    mix(this.nextStructureId);
    for (const s of this.structures)
      for (const value of [s.id, s.player, s.kind, s.tile, s.readyAt, s.reloadAt]) mix(value);
    mix(this.alliances.length);
    for (const a of this.alliances)
      for (const value of [a.a, a.b, a.until, a.renewA ? 1 : 0, a.renewB ? 1 : 0]) mix(value);
    mix(this.allianceRequests.length);
    for (const r of this.allianceRequests)
      for (const value of [r.from, r.to, r.expiresAt]) mix(value);
    mix(this.requestCooldowns.length);
    for (const c of this.requestCooldowns) for (const value of [c.from, c.to, c.until]) mix(value);
    mix(this.nextTradeShipId);
    mix(this.tradeShips.length);
    for (const t of this.tradeShips) {
      for (const value of [t.id, t.player, t.port, t.from, t.to, t.step, t.path.length]) mix(value);
      // The ends of its route, which the route cache outside the state chose.
      mix(t.path[0] ?? -1);
      mix(t.path[t.path.length - 1] ?? -1);
    }
    mix(this.nextWarshipId);
    for (const w of this.warships) {
      for (const value of [
        w.id,
        w.player,
        w.tile,
        w.health,
        w.patrol,
        w.step,
        w.path.length,
        w.reloadAt,
      ])
        mix(value);
    }
    mix(this.nextMissileId);
    mix(this.missiles.length);
    for (const m of this.missiles) {
      for (const value of [m.id, m.player, m.size, m.from, m.to, m.launchedAt, m.arrivesAt]) {
        mix(value);
      }
      mix(m.tried.length);
      for (const id of m.tried) mix(id);
    }
    mix(this.fallout.length);
    for (const f of this.fallout) for (const value of [f.tile, f.radius, f.until]) mix(value);
    mix(this.fights.length);
    for (const f of this.fights) for (const value of [f.a, f.b, f.until]) mix(value);
    mix(this.embargoes.length);
    for (const e of this.embargoes) for (const value of [e.from, e.to, e.since]) mix(value);
    mix(this.winner ?? 0);
    // Free-for-all games hash as they did before teams existed.
    if (this.teams > 0) {
      mix(this.teams);
      for (const p of this.sortedPlayers) mix(p.team);
      mix(this.winningTeam ?? 0);
    }
    // So do games that leave nothing out, and games without quick messages.
    if (this.disabled !== 0) mix(this.disabled);
    for (const c of this.quickCooldowns) {
      if (this.currentTick < c.until) for (const value of [c.player, c.until]) mix(value);
    }
    mix(this.decidedAt ?? -1);
    return hash >>> 0;
  }

  /** Valid orders are offered to handlers in turn until one carries them out. */
  onOrder(handler: OrderHandler): void {
    this.handlers.push(handler);
  }

  onTick(system: TickSystem): void {
    this.systems.push(system);
  }

  /**
   * Carries out one order now, if it is valid: the path of every order of a
   * turn, and of orders that computer players decide during a tick (R-BOT-03).
   * Orders of eliminated or unknown players are ignored. Returns whether the
   * order was carried out.
   */
  apply(playerId: number, order: Order): boolean {
    const player = this.playersById.get(playerId);
    if (!player?.alive || orderError(this, player, order) !== undefined) return false;
    return this.handlers.some((handle) => handle(this, player, order));
  }

  /**
   * Runs one tick: the turn's orders, then every system. Turns must arrive in
   * sequence; a gap or a repeat means the client is out of step with the server.
   * Returns how many of the turn's orders were carried out.
   */
  step(turn: Turn): number {
    if (turn.tick !== this.currentTick) {
      throw new RangeError(`expected turn ${String(this.currentTick)}, got ${String(turn.tick)}`);
    }
    let applied = 0;
    for (const { player, order } of turn.orders) if (this.apply(player, order)) applied++;
    for (const system of this.systems) system(this);
    this.currentTick++;
    return applied;
  }
}

/** FNV-1a over the balance values, by key name, so the order fields were written in does not matter. */
function digestBalance(balance: Balance): number {
  let digest = 0x811c9dc5;
  const record = balance as unknown as Record<string, number | readonly number[]>;
  for (const key of Object.keys(record).sort()) {
    for (let i = 0; i < key.length; i++) digest = Math.imul(digest ^ key.charCodeAt(i), 0x01000193);
    const value = record[key];
    for (const number of typeof value === "number" ? [value] : (value ?? [])) {
      // Halves, like the state hash: balance values are safe integers.
      for (const word of [number >>> 0, Math.floor(number / 2 ** 32) >>> 0]) {
        for (let shift = 0; shift < 32; shift += 8) {
          digest = Math.imul(digest ^ ((word >>> shift) & 0xff), 0x01000193);
        }
      }
    }
  }
  return digest >>> 0;
}

/** Refuses balance values the rules cannot run with, before the first tick rather than during one. */
function checkBalance(balance: Balance): void {
  const atLeastOne: (keyof Balance)[] = [
    "ticksPerSecond",
    "attackSpeedDivisor",
    "encircleMaxTiles",
    "boatSpeed",
    "boatMax",
    "boatRange",
    "cityLand",
    "tradeRange",
    "tradeIntervalTicks",
    "warshipPatrol",
    "warshipReloadTicks",
    "warshipDamage",
    "warshipHealth",
    "missileSpeed",
    "allianceRequestTicks",
    "allianceTicks",
    "maxDurationTicks",
  ];
  for (const key of atLeastOne) {
    const value = balance[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`balance ${key} must be a positive integer`);
    }
  }
  // Two structures on one tile would make demolition ambiguous; a cheaper next structure, or a negative cost, would print gold.
  if (!Number.isSafeInteger(balance.buildSpacing) || balance.buildSpacing < 1) {
    throw new RangeError("balance buildSpacing must be a positive integer");
  }
  for (const key of [
    "cityCost",
    "fortCost",
    "portCost",
    "buildTicks",
    "tradeMax",
    "warshipCost",
    "warshipMax",
    "warshipRange",
    "warMemoryTicks",
    "embargoNoticeTicks",
    "siloCost",
    "airDefenseCost",
    "longBuildTicks",
    "siloReloadTicks",
    "missileCost",
    "heavyMissileCost",
    "missileRadius",
    "heavyMissileRadius",
    "falloutTicks",
    "airDefenseRadius",
    "airDefenseReloadTicks",
    "tradeBase",
    "tradePerTile",
    "allianceRenewTicks",
    "allianceCooldownTicks",
    "traitorTicks",
    "traitorDefensePercent",
  ] as const) {
    if (!Number.isSafeInteger(balance[key]) || balance[key] < 0) {
      throw new RangeError(`balance ${key} must be a non-negative integer`);
    }
  }
  const chance = balance.airDefenseChancePercent;
  if (!Number.isSafeInteger(chance) || chance < 0 || chance > 100) {
    throw new RangeError("balance airDefenseChancePercent must be from 0 to 100");
  }
  if (!Number.isSafeInteger(balance.costGrowthPercent) || balance.costGrowthPercent < 100) {
    throw new RangeError("balance costGrowthPercent must be 100 or more");
  }
  // Ship routes keep their distances in 16 bits.
  if (balance.boatRange > 0xffff) throw new RangeError("balance boatRange is above 65535");
  if (balance.tradeRange > 0xffff) throw new RangeError("balance tradeRange is above 65535");
}
