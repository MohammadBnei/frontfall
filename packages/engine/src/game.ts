import { DEFAULT_BALANCE, type Balance } from "./balance.ts";
import { orderError } from "./orders.ts";
import { Random } from "./random.ts";
import type { Terrain } from "./terrain.ts";
import { MAX_PLAYER_ID, TerritoryMap } from "./territory/territory-map.ts";

/** An order from a player, as relayed by the server in a turn. */
export type Order =
  { type: "spawn"; tile: number } | { type: "attack"; target: number; troops: number };

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
  alive: boolean;
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
  private readonly playersById = new Map<number, Player>();
  private readonly handlers: OrderHandler[] = [];
  private readonly systems: TickSystem[] = [];
  private currentTick = 0;

  constructor(setup: GameSetup) {
    this.terrain = setup.terrain;
    this.random = new Random(setup.seed);
    this.balance = setup.balance ?? DEFAULT_BALANCE;
    let highest = 1;
    for (const { id, name } of setup.players) {
      if (!Number.isInteger(id) || id < 1 || id > MAX_PLAYER_ID) {
        throw new RangeError(`invalid player id ${String(id)}`);
      }
      if (this.playersById.has(id)) throw new RangeError(`duplicate player id ${String(id)}`);
      this.playersById.set(id, { id, name, troops: 0, gold: 0, alive: true });
      highest = Math.max(highest, id);
    }
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
  players(): Player[] {
    return [...this.playersById.values()].sort((a, b) => a.id - b.id);
  }

  /** Valid orders are offered to handlers in turn until one carries them out. */
  onOrder(handler: OrderHandler): void {
    this.handlers.push(handler);
  }

  onTick(system: TickSystem): void {
    this.systems.push(system);
  }

  /**
   * Runs one tick: the turn's orders, then every system. Turns must arrive in
   * sequence; a gap or a repeat means the client is out of step with the server.
   * Invalid orders, and orders of eliminated or unknown players, are skipped.
   * Returns how many orders were applied.
   */
  step(turn: Turn): number {
    if (turn.tick !== this.currentTick) {
      throw new RangeError(`expected turn ${String(this.currentTick)}, got ${String(turn.tick)}`);
    }
    let applied = 0;
    for (const { player: id, order } of turn.orders) {
      const player = this.playersById.get(id);
      if (!player?.alive || orderError(this, player, order) !== undefined) continue;
      if (this.handlers.some((handle) => handle(this, player, order))) applied++;
    }
    for (const system of this.systems) system(this);
    this.currentTick++;
    return applied;
  }
}
