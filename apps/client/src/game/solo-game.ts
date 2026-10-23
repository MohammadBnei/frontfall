import {
  Terrain,
  TurnClock,
  WorldGrid,
  createGame,
  installBots,
  populationCap,
  type Game,
  type Order,
  type Phase,
} from "@frontfall/engine";
import { loadMap } from "./maps.ts";

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

export interface GameUpdate {
  tick: number;
  phase: Phase;
  /** Ticks left before attacks open; 0 once the game is under way. */
  spawnTicksLeft: number;
  players: PlayerView[];
  /** Troops of the human's attacks under way, one entry per attack. */
  attacks: { target: number; troops: number }[];
  /** Tiles that changed owner this tick, and their new owners, pair by pair. */
  changedTiles: Int32Array;
  changedOwners: Uint16Array;
  /** Set instead of the change lists when too much changed to list. */
  owners?: Uint16Array;
  winner?: number;
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

/**
 * One solo game: the engine with every rule installed, bots for every other
 * player, and a turn clock that closes the human's orders into turns as the
 * server does online. Runs in a worker in the browser and directly in tests.
 */
export class SoloGame {
  readonly game: Game;
  readonly ownableTiles: number;
  private readonly clock: TurnClock;

  constructor(readonly options: SoloOptions) {
    const map = loadMap(options.map);
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
    let ownable = 0;
    for (let tile = 0; tile < grid.size; tile++) if (terrain.isOwnable(tile)) ownable++;
    this.ownableTiles = ownable;
  }

  get winner(): number | undefined {
    return this.game.winner;
  }

  /**
   * What a click on `tile` means for the human now: pick a start during the
   * spawn phase, then expand or attack with `ratio` percent of their troops.
   * Undefined when the click asks for nothing the rules allow.
   */
  orderForClick(tile: number, ratio: number): Order | undefined {
    const { game } = this;
    const human = game.player(HUMAN_ID);
    if (!human?.alive || game.winner !== undefined) return undefined;
    if (!Number.isInteger(tile) || tile < 0 || tile >= game.terrain.topology.size) return undefined;
    if (!game.terrain.isOwnable(tile)) return undefined;
    if (game.phase === "spawn") return { type: "spawn", tile };
    if (game.territory.ownerOf(tile) === HUMAN_ID) return undefined;
    const troops = Math.floor((human.troops * Math.min(100, Math.max(0, ratio))) / 100);
    return troops >= 1 ? { type: "attack", target: tile, troops } : undefined;
  }

  /** Runs one tick with the human's orders and returns what changed. */
  step(orders: readonly Order[]): GameUpdate {
    if (this.game.winner === undefined) {
      for (const order of orders) this.clock.submit(HUMAN_ID, order);
      this.clock.advance();
    }
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
        .map((attack) => ({ target: attack.target, troops: attack.troops })),
      changedTiles: new Int32Array(0),
      changedOwners: new Uint16Array(0),
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
    if (game.winner !== undefined) update.winner = game.winner;
    return update;
  }
}
