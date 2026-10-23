import type { Attack } from "./attacks.ts";
import { DEFAULT_BALANCE, type Balance } from "./balance.ts";
import type { Boat } from "./boats.ts";
import { orderError } from "./orders.ts";
import { Random } from "./random.ts";
import type { Terrain } from "./terrain.ts";
import { MAX_PLAYER_ID, TerritoryMap } from "./territory/territory-map.ts";

/** An order from a player, as relayed by the server in a turn. */
export type Order =
  | { type: "spawn"; tile: number }
  | { type: "attack"; target: number; troops: number }
  | { type: "retreat"; attack: number }
  | { type: "embark"; target: number; troops: number };

/** Every order accepted during one tick, in the order the server accepted them (R-FAIR-03). */
export interface Turn {
  tick: number;
  orders: readonly { player: number; order: Order }[];
}

export interface PlayerSetup {
  /** 1 to MAX_PLAYER_ID; 0 is the neutral owner. */
  id: number;
  name: string;
}

export interface GameSetup {
  terrain: Terrain;
  seed: number;
  players: readonly PlayerSetup[];
  balance?: Balance;
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
}

export type Phase = "spawn" | "play";

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
  readonly balance: Balance;
  /** Attacks under way, oldest first. Owned by the attack rules; read only elsewhere. */
  readonly attacks: Attack[] = [];
  nextAttackId = 1;
  /** Transport ships at sea, oldest first. Owned by the boat rules; read only elsewhere. */
  readonly boats: Boat[] = [];
  nextBoatId = 1;
  /** Winner once the game is decided (R-WIN), and the tick it happened. */
  winner: number | undefined;
  decidedAt: number | undefined;
  private readonly playersById = new Map<number, Player>();
  private readonly sortedPlayers: readonly Player[];
  private readonly handlers: OrderHandler[] = [];
  private readonly systems: TickSystem[] = [];
  private currentTick = 0;

  constructor(setup: GameSetup) {
    this.terrain = setup.terrain;
    this.random = new Random(setup.seed);
    this.balance = setup.balance ?? DEFAULT_BALANCE;
    checkBalance(this.balance);
    let highest = 1;
    for (const { id, name } of setup.players) {
      if (!Number.isInteger(id) || id < 1 || id > MAX_PLAYER_ID) {
        throw new RangeError(`invalid player id ${String(id)}`);
      }
      if (this.playersById.has(id)) throw new RangeError(`duplicate player id ${String(id)}`);
      this.playersById.set(id, {
        id,
        name,
        troops: 0,
        gold: 0,
        goldRemainder: 0,
        alive: true,
        start: undefined,
      });
      highest = Math.max(highest, id);
    }
    this.sortedPlayers = [...this.playersById.values()].sort((a, b) => a.id - b.id);
    this.territory = new TerritoryMap(setup.terrain.topology, highest);
  }

  /** Number of the next tick to run; also the number of ticks run so far. */
  get tick(): number {
    return this.currentTick;
  }

  get phase(): Phase {
    return this.currentTick < this.balance.spawnPhaseTicks ? "spawn" : "play";
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
    mix(this.winner ?? 0);
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

/** Refuses balance values the rules cannot run with, before the first tick rather than during one. */
function checkBalance(balance: Balance): void {
  const atLeastOne: (keyof Balance)[] = [
    "ticksPerSecond",
    "attackSpeedDivisor",
    "encircleMaxTiles",
    "boatSpeed",
    "boatMax",
    "boatRange",
    "maxDurationTicks",
  ];
  for (const key of atLeastOne) {
    const value = balance[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`balance ${key} must be a positive integer`);
    }
  }
  // Ship routes keep their distances in 16 bits.
  if (balance.boatRange > 0xffff) throw new RangeError("balance boatRange is above 65535");
}
