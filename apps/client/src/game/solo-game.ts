import {
  Terrain,
  TurnClock,
  WorldGrid,
  createGame,
  installBots,
  populationCap,
  seaRoute,
  type Game,
  type Order,
  type Phase,
} from "@frontfall/engine";
import { labelAnchors, type LabelAnchor } from "./label-anchors.ts";
import type { MapData } from "./maps.ts";

export const HUMAN_ID = 1;

export type Difficulty = "easy" | "normal" | "hard";

export interface SoloOptions {
  map: string;
  seed: number;
  bots: number;
  difficulty: Difficulty;
  playerName: string;
}

export interface PlayerView {
  id: number;
  name: string;
  troops: number;
  /** Troops the player's land can hold (R-ECO-01). */
  cap: number;
  gold: number;
  tiles: number;
  alive: boolean;
}

/** One of the human's attacks under way; its id is what a retreat order names. */
export interface AttackView {
  id: number;
  /** Owner of the land under attack, 0 for unclaimed land. */
  target: number;
  troops: number;
}

export interface GameUpdate {
  tick: number;
  phase: Phase;
  /** Ticks left before attacks open; 0 once the game is under way. */
  spawnTicksLeft: number;
  players: PlayerView[];
  /** Troops of the human's attacks under way, one entry per attack. */
  attacks: AttackView[];
  /** Tiles that changed owner this tick, and their new owners, pair by pair. */
  changedTiles: Int32Array;
  changedOwners: Uint16Array;
  /** Where players' names go, every LABEL_TICKS ticks; the last ones hold in between. */
  labels?: LabelAnchor[];
  /** Every ship at sea. */
  boats: BoatView[];
  /** Set instead of the change lists when too much changed to list. */
  owners?: Uint16Array;
  winner?: number;
}

/** Why a click on the map leads to no order. */
export type ClickRefusal =
  /** Water, ice or off the map. */
  | "terrain"
  | "own"
  /** The attack ratio leaves less than one troop. */
  | "troops"
  /** No shared border and no sea route to a coast. */
  | "unreachable"
  /** B-BOAT-MAX ships are already at sea. */
  | "ships"
  /** The game is decided, or the player is out. */
  | "over";

export type ClickResult = { order: Order } | { refused: ClickRefusal };

/** A transport ship at sea, where it is this tick. */
export interface BoatView {
  id: number;
  player: number;
  tile: number;
  troops: number;
}

/** Names for computer players. Invented, so they never collide with real countries. */
const BOT_NAMES = [
  "Aldmere",
  "Brask",
  "Corvan",
  "Dunmoor",
  "Elsk",
  "Fenwold",
  "Gorran",
  "Halvik",
  "Istra",
  "Jorvel",
  "Kesh",
  "Lorne",
  "Mirava",
  "Norrin",
  "Ostmark",
  "Pellan",
  "Quill",
  "Ravenna",
  "Sorrel",
  "Tarsk",
  "Ulvar",
  "Vesk",
  "Wyndham",
  "Yarrow",
  "Zennor",
];

export const MAX_BOTS = BOT_NAMES.length;

/** Names follow the land twice a second at the default tick rate: a scan of the map each time. */
const LABEL_TICKS = 5;

/**
 * One solo game: the engine with every rule installed, bots for every other
 * player, and a turn clock that closes the human's orders into turns as the
 * server does online. Runs in a worker in the browser and directly in tests.
 */
export class SoloGame {
  readonly game: Game;
  readonly ownableTiles: number;
  private readonly clock: TurnClock;
  private readonly depth: Uint16Array;

  constructor(
    readonly options: SoloOptions,
    map: MapData,
  ) {
    const grid = new WorldGrid(map.width, map.height, { wrapsX: map.wrapsX });
    const terrain = new Terrain(grid, map.kinds);
    const bots = Math.max(0, Math.min(MAX_BOTS, Math.floor(options.bots)));
    const players = [{ id: HUMAN_ID, name: options.playerName }];
    for (let i = 0; i < bots; i++) {
      players.push({ id: HUMAN_ID + 1 + i, name: BOT_NAMES[i] as string });
    }
    this.game = createGame({ terrain, seed: options.seed, players });
    installBots(
      this.game,
      players.slice(1).map((player) => player.id),
      options.difficulty,
    );
    this.clock = new TurnClock(this.game);
    this.depth = new Uint16Array(grid.size);
    let ownable = 0;
    for (let tile = 0; tile < grid.size; tile++) if (terrain.isOwnable(tile)) ownable++;
    this.ownableTiles = ownable;
  }

  get winner(): number | undefined {
    return this.game.winner;
  }

  /**
   * What a click on `tile` means for the human now: pick a start during the
   * spawn phase, then expand or attack with `ratio` percent of their troops,
   * by land when the target touches their land, by sea when it is a coast
   * on another land mass. Otherwise, why nothing happens.
   */
  orderForClick(tile: number, ratio: number): ClickResult {
    const { game } = this;
    const { terrain, territory } = game;
    const human = game.player(HUMAN_ID);
    if (!human?.alive || game.winner !== undefined) return { refused: "over" };
    if (!Number.isInteger(tile) || tile < 0 || tile >= terrain.topology.size) {
      return { refused: "terrain" };
    }
    if (!terrain.isOwnable(tile)) return { refused: "terrain" };
    if (game.phase === "spawn") return { order: { type: "spawn", tile } };
    if (territory.ownerOf(tile) === HUMAN_ID) return { refused: "own" };
    const troops = Math.floor((human.troops * Math.min(100, Math.max(0, ratio))) / 100);
    if (troops < 1) return { refused: "troops" };

    // By land when the player borders the target's owner on the target's own
    // land mass: an attack starts from that border, so it must reach the click.
    const owner = territory.ownerOf(tile);
    const mass = terrain.landmassOf(tile);
    const around = new Int32Array(4);
    let touches = false;
    for (let i = 0; i < territory.borderCount(HUMAN_ID) && !touches; i++) {
      const border = territory.borderTile(HUMAN_ID, i);
      if (terrain.landmassOf(border) !== mass) continue;
      const count = terrain.topology.neighborsInto(border, around);
      for (let j = 0; j < count; j++) {
        const next = around[j] as number;
        if (territory.ownerOf(next) === owner && terrain.isOwnable(next)) touches = true;
      }
    }
    if (touches) {
      return { order: { type: "attack", target: tile, troops } };
    }
    if (terrain.isCoast(tile) && seaRoute(game, HUMAN_ID, tile)) {
      const atSea = game.boats.filter((boat) => boat.player === HUMAN_ID).length;
      if (atSea >= game.balance.boatMax) return { refused: "ships" };
      return { order: { type: "embark", target: tile, troops } };
    }
    return { refused: "unreachable" };
  }

  /**
   * Runs one tick with the human's orders and returns what changed. Once the
   * game is decided the bots play on for spectators (R-WIN-03), and the
   * human's orders are dropped.
   */
  step(orders: readonly Order[]): GameUpdate {
    if (this.game.winner === undefined) {
      for (const order of orders) this.clock.submit(HUMAN_ID, order);
    }
    this.clock.advance();
    return this.update();
  }

  private update(): GameUpdate {
    const { game } = this;
    const territory = game.territory;
    const players = game.players().map((player) => ({
      id: player.id,
      name: player.name,
      troops: player.troops,
      cap: populationCap(game, player),
      gold: player.gold,
      tiles: territory.tileCount(player.id),
      alive: player.alive,
    }));
    const update: GameUpdate = {
      tick: game.tick,
      phase: game.phase,
      spawnTicksLeft: Math.max(0, game.balance.spawnPhaseTicks - game.tick),
      players,
      attacks: game.attacks
        .filter((attack) => attack.player === HUMAN_ID)
        .map((attack) => ({ id: attack.id, target: attack.target, troops: attack.troops })),
      changedTiles: new Int32Array(0),
      changedOwners: new Uint16Array(0),
      boats: game.boats.map((boat) => ({
        id: boat.id,
        player: boat.player,
        // The water tile the ship has reached, its first one before it sails.
        tile: boat.path[Math.max(0, Math.min(boat.step, boat.path.length) - 1)] ?? boat.target,
        troops: boat.troops,
      })),
    };
    if (territory.changesOverflowed) {
      update.owners = territory.owners.slice();
    } else {
      const changes = territory.changes();
      update.changedTiles = changes.slice();
      update.changedOwners = new Uint16Array(changes.length);
      for (let i = 0; i < changes.length; i++) {
        update.changedOwners[i] = territory.owners[changes[i] as number] as number;
      }
    }
    territory.clearChanges();
    if (game.tick % LABEL_TICKS === 0) {
      const width = game.terrain.topology.width;
      update.labels = labelAnchors(territory.owners, width, players.length, this.depth);
    }
    if (game.winner !== undefined) update.winner = game.winner;
    return update;
  }
}
