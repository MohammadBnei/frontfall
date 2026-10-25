import {
  DEFAULT_BALANCE,
  DESYNC_REPORT_VERSION,
  GAME_RECORD_VERSION,
  Terrain,
  WorldGrid,
  createGame,
  loadSnapshot,
  saveSnapshot,
  BuildError,
  StructureKind,
  TileKind,
  WarshipError,
  atWar,
  quickAllowedAt,
  warshipCost,
  MissileError,
  MissileSize,
  launchSilo,
  missileCost,
  missileTile,
  allianceOf,
  alliesOf,
  sameTeam,
  canRenew,
  cityLimit,
  cityShare,
  isAllied,
  installBots,
  installNations,
  isReady,
  orderError,
  populationCap,
  seaRoute,
  structureCost,
  type DesyncReport,
  type Game,
  type GameRecord,
  type Balance,
  type Order,
  type PlayerSetup,
  type Structure,
  type Phase,
  type Turn,
} from "@frontfall/engine";
import { HASH_INTERVAL, PROTOCOL_VERSION } from "@frontfall/protocol";
import { BUILD } from "../net/build.ts";
import { RELEASE } from "../release.ts";
import { labelAnchors, type LabelAnchor } from "./label-anchors.ts";
import type { MapData } from "./maps.ts";

export const HUMAN_ID = 1;

export type Difficulty = "easy" | "normal" | "hard";

/** What a click on the map does: attack by default, or build or demolish once picked in the HUD. */
export type ClickMode =
  | "attack"
  | "city"
  | "palace"
  | "fort"
  | "port"
  | "silo"
  | "airDefense"
  | "warship"
  | "missile"
  | "heavyMissile"
  | "demolish";

/** Tiles around a click within which a demolition finds the player's structure: one is a few pixels wide. */
const DEMOLISH_REACH = 3;
/**
 * Tiles around a click within which a port finds the player's coast: on a
 * large map the coast is a line under a pixel wide, so a click by the water,
 * on the land or the sea, picks the closest coast tile that takes a port.
 */
const PORT_REACH = 8;

export interface SoloOptions {
  map: string;
  seed: number;
  bots: number;
  difficulty: Difficulty;
  /** Whether the map's nations play, after the bots (R-BOT-07); off when left out. */
  nations?: boolean | undefined;
  /** Teams the players are dealt into (R-MODE-02): 2 to 4, or 0 or left out for a free-for-all. */
  teams?: number | undefined;
  /** What the game leaves out (R-MODE-03), as the engine's `Disable` bits; nothing when left out. */
  disabled?: number | undefined;
  playerName: string;
  /**
   * For tests that play a game to its end: ticks run per beat of the clock
   * (1 by default), and a time limit in minutes instead of B-MAX-DURATION.
   */
  speed?: number | undefined;
  maxMinutes?: number | undefined;
  /** For tests that build: B-GOLD-RATE instead of its value in the balance. */
  goldRate?: number | undefined;
  /** For tests that build a palace on a small map: B-CITY-LAND instead of its value. */
  cityLand?: number | undefined;
  /**
   * Online: the human players in their final numbering, and which one plays
   * at this screen. Bots then take the numbers after the last human, and
   * `playerName` is not used.
   */
  players?: readonly { id: number; name: string }[] | undefined;
  you?: number | undefined;
  /**
   * A finished game to watch again: its setup replaces every option above
   * but `map` and `speed`, and its turns are the only orders (#50).
   */
  record?: GameRecord | undefined;
  /**
   * Online: where this browser left the game before a reload (#39). The
   * game starts from it, and only the turns after it are played.
   */
  snapshot?: GameSnapshot | undefined;
}

/** A game between two ticks, and every turn with orders before. */
export interface GameSnapshot {
  tick: number;
  bytes: Uint8Array;
  history: Turn[];
}

/** How far a replay has got; `hash` once it reached its last tick, to compare with `expected`. */
export interface ReplayView {
  ticks: number;
  expected: number;
  hash?: number;
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
  /** The player at this screen. */
  you: number;
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
  /** Every transport ship at sea. */
  boats: BoatView[];
  /** Every trade ship at sea (R-UNIT-03). */
  tradeShips: TradeShipView[];
  /** Every warship (R-UNIT-04). */
  warships: WarshipView[];
  /** Every missile in flight (R-UNIT-05). */
  missiles: MissileView[];
  /** Land under fallout (R-UNIT-06), as discs. */
  fallout: FalloutView[];
  /** Every structure on the map. */
  structures: StructureView[];
  /** What the player at this screen can build next. */
  build: BuildView;
  /** Alliances, requests and traitors, as the player at this screen sees them. */
  diplomacy: DiplomacyView;
  /** What changed between players since the last update, for every player to read (R-DIPLO-04). */
  events: DiplomacyEvent[];
  /** Set instead of the change lists when too much changed to list. */
  owners?: Uint16Array;
  winner?: number;
  /** In a team game, the team that won (R-MODE-02). */
  winningTeam?: number;
  /** Online: state hashes after the ticks the server checks (`HASH_INTERVAL`). */
  hashes?: { tick: number; hash: number }[];
  /** Set while watching a recorded game. */
  replay?: ReplayView;
}

/** Why a click on the map leads to no order. */
export type ClickRefusal =
  /** Water, ice or off the map. */
  | "terrain"
  | "own"
  /** Land of a teammate, who is never attacked (R-MODE-02). */
  | "teammate"
  /** The attack ratio leaves less than one troop. */
  | "troops"
  /** No shared border and no sea route to a coast. */
  | "unreachable"
  /** B-BOAT-MAX ships are already at sea. */
  | "ships"
  /** The game is decided, or the player is out. */
  | "over"
  /** Building opens with the attacks, after the spawn phase. */
  | "early"
  /** A structure goes on the player's own land only. */
  | "foreign"
  /** A port needs a tile by the water (R-BUILD-02). */
  | "coast"
  /** A warship is bought at a ready port of the player's (R-UNIT-04). */
  | "port"
  /** The port has no water next to it for a warship to start on. */
  | "shore"
  /** The player has B-WARSHIP-MAX warships already. */
  | "warships"
  /** No warship of the player's can sail to that water. */
  | "noWarship"
  /** No silo of the player's is built and loaded (R-BUILD-04). */
  | "silo"
  /** Another structure stands closer than B-BUILD-SPACING. */
  | "crowded"
  /** The player's land supports no more cities (R-BUILD-07). */
  | "land"
  | "gold"
  /** No structure of the player's near the click to demolish. */
  | "nothing"
  /** The land belongs to an ally: betray them first (R-DIPLO-02). */
  | "ally"
  /** A missile's blast would reach an ally's or a teammate's land (R-UNIT-05). */
  | "allyNear"
  /** Left out of this game by its host (R-MODE-03). */
  | "disabled";

/** Something to know about an order that was sent all the same. */
export type ClickNote =
  /** A port on a lake trades only with ports on the same lake (R-MAP-05). */
  "lake";

export type ClickResult = { order: Order; note?: ClickNote } | { refused: ClickRefusal };

export type StructureType = "city" | "palace" | "fort" | "port" | "silo" | "airDefense";

export interface StructureView {
  id: number;
  player: number;
  type: StructureType;
  tile: number;
  /** False while it is being built (B-BUILD-TIME). */
  ready: boolean;
}

export interface BuildView {
  /** Gold the next city and the next fort cost the player. */
  cityCost: number;
  /** What the next two cities would cost together (R-BUILD-08). */
  palaceCost: number;
  fortCost: number;
  portCost: number;
  warshipCost: number;
  siloCost: number;
  airDefenseCost: number;
  missileCost: number;
  heavyMissileCost: number;
  /** Whether a silo of the player's has a missile ready. */
  loaded: boolean;
  /** Cities owned or being built, a palace counting as two. */
  cities: number;
  /** Most cities the player's land supports now. */
  cityLimit: number;
}

const STRUCTURE_KINDS: Readonly<Record<StructureType, StructureKind>> = {
  city: StructureKind.City,
  palace: StructureKind.Palace,
  fort: StructureKind.Fort,
  port: StructureKind.Port,
  silo: StructureKind.Silo,
  airDefense: StructureKind.AirDefense,
};

const STRUCTURE_TYPES: Readonly<Record<StructureKind, StructureType>> = {
  [StructureKind.City]: "city",
  [StructureKind.Fort]: "fort",
  [StructureKind.Port]: "port",
  [StructureKind.Silo]: "silo",
  [StructureKind.AirDefense]: "airDefense",
  [StructureKind.Palace]: "palace",
};

/** Engine refusals of a build order, as the interface explains them: one for each BuildError. */
const BUILD_REFUSALS: Readonly<Record<BuildError, ClickRefusal>> = {
  [BuildError.Early]: "early",
  [BuildError.Foreign]: "foreign",
  [BuildError.Crowded]: "crowded",
  [BuildError.Land]: "land",
  [BuildError.Coast]: "coast",
  [BuildError.Gold]: "gold",
  [BuildError.Disabled]: "disabled",
};

function isBuildError(error: string): error is BuildError {
  return Object.hasOwn(BUILD_REFUSALS, error);
}

/** Alliances and requests of the player at this screen, and every traitor, with their time left in ticks. */
export interface DiplomacyView {
  allies: AllyView[];
  /** The player's teammates (R-MODE-02), allies for the whole game; empty in a free-for-all. */
  teammates: number[];
  /** Requests to the player, oldest first. */
  incoming: { from: number; ticksLeft: number }[];
  /** Players the player has asked and who have not answered yet. */
  outgoing: number[];
  /** Players who may not be asked yet: a request ran out, or the player betrayed them. */
  waiting: number[];
  traitors: { id: number; ticksLeft: number }[];
  /** Players under the embargo of the player at this screen (R-DIPLO-05). */
  embargoes: number[];
  /** Players whose embargo is on the player at this screen. */
  embargoedBy: number[];
  /** Players at war with the player at this screen, who take no gift (R-DIPLO-06). */
  atWar: number[];
  /** Ticks before the player at this screen may send another quick message (R-DIPLO-07). */
  quickIn: number;
}

export interface AllyView {
  id: number;
  ticksLeft: number;
  /** In the last part of the alliance, when both may renew it (R-DIPLO-03). */
  renewable: boolean;
  /** The player at this screen has asked to renew; the ally has not yet. */
  renewing: boolean;
}

/** An alliance formed, run out, or broken by `a`, or an embargo of `a` on `b` started or lifted. `a` and `b` are player ids. */
export interface DiplomacyEvent {
  type:
    | "allied"
    | "ended"
    | "betrayed"
    | "embargo"
    | "lifted"
    | "captured"
    | "missile"
    | "stopped"
    | "gift"
    | "quick";
  a: number;
  b: number;
  /** A quick message, by number (R-DIPLO-07). */
  phrase?: number;
}

/** A warship, where it is this tick. */
export interface WarshipView {
  id: number;
  player: number;
  tile: number;
  health: number;
}

/** A missile in flight, where it is this tick (R-UNIT-05). */
export interface MissileView {
  id: number;
  player: number;
  heavy: boolean;
  tile: number;
  /** Its target, and the owner of the target when it was last seen. */
  to: number;
  target: number;
}

/** A disc of land under fallout (R-UNIT-06). */
export interface FalloutView {
  tile: number;
  radius: number;
}

/** A trade ship at sea, where it is this tick. */
export interface TradeShipView {
  id: number;
  player: number;
  tile: number;
}

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

/** Players and balance of a new game: the humans, then the bots, then the map's nations. */
function newSetup(
  options: SoloOptions,
  map: MapData,
): { players: PlayerSetup[]; botIds: number[]; nationIds: number[]; balance: Balance } {
  const bots = Math.max(0, Math.min(MAX_BOTS, Math.floor(options.bots)));
  const humans = options.players ?? [{ id: HUMAN_ID, name: options.playerName }];
  const firstBot = Math.max(...humans.map((human) => human.id)) + 1;
  const players: PlayerSetup[] = [...humans];
  const botIds: number[] = [];
  for (let i = 0; i < bots; i++) {
    botIds.push(firstBot + i);
    players.push({ id: firstBot + i, name: BOT_NAMES[i] as string });
  }
  // Nations take the numbers after the bots, in the manifest's order, the same on every client.
  const nationIds: number[] = [];
  if (options.nations) {
    for (const { name, tile } of map.nations) {
      const id = firstBot + bots + nationIds.length;
      nationIds.push(id);
      players.push({ id, name, start: tile });
    }
  }
  const balance = { ...DEFAULT_BALANCE };
  if (options.maxMinutes !== undefined) {
    balance.maxDurationTicks = Math.round(options.maxMinutes * 60 * DEFAULT_BALANCE.ticksPerSecond);
  }
  if (options.goldRate !== undefined) balance.goldPerThousandTroops = Math.floor(options.goldRate);
  if (options.cityLand !== undefined) balance.cityLand = Math.floor(options.cityLand);
  return { players, botIds, nationIds, balance };
}

/**
 * One game as this client runs it: the engine with every rule installed and
 * the bots. Online, it plays the turns the server relays (`playTurns`); solo,
 * `step` relays the player's orders into the same kind of turn, so both go
 * down one path. Runs in a worker in the browser and directly in tests.
 */
export class SoloGame {
  readonly game: Game;
  readonly ownableTiles: number;
  /** The player at this screen. */
  readonly you: number;
  /** Online games report state hashes; a solo game has no one to compare with. */
  private readonly online: boolean;
  private readonly depth: Uint16Array;
  private readonly players: PlayerSetup[];
  private readonly botIds: number[];
  private readonly nationIds: number[];
  private readonly difficulty: Difficulty;
  /** Every turn with orders, for a record of the game and, online, a desync report. */
  private readonly history: Turn[] = [];
  /** Turns of the game being watched again, by tick. */
  private readonly recorded: ReadonlyMap<number, Turn["orders"]> | undefined;
  private readonly hashes: { tick: number; local: number }[] = [];
  /** Why the snapshot of the options could not be loaded; the game then starts from its first tick. */
  readonly snapshotRefused: string | undefined;
  /** Hashes the server says most players had, where this client's differed. */
  private readonly expected = new Map<number, number | null>();

  constructor(
    readonly options: SoloOptions,
    private readonly map: MapData,
  ) {
    const grid = new WorldGrid(map.width, map.height, { wrapsX: map.wrapsX });
    const terrain = new Terrain(grid, map.kinds);
    const { record } = options;
    const { players, botIds, nationIds, balance } = record
      ? {
          players: record.players,
          botIds: record.bots.ids,
          nationIds: record.nations ?? [],
          balance: record.balance,
        }
      : newSetup(options, map);
    this.you = options.record?.you ?? options.you ?? HUMAN_ID;
    const seed = options.record?.seed ?? options.seed;
    const teams = options.record ? (options.record.teams ?? 0) : (options.teams ?? 0);
    const disabled = options.record ? (options.record.disabled ?? 0) : (options.disabled ?? 0);
    const difficulty = options.record?.bots.difficulty ?? options.difficulty;
    const create = (): Game => {
      const game = createGame({ terrain, seed, players, balance, teams, disabled });
      installBots(game, botIds, difficulty);
      installNations(game, nationIds, difficulty);
      return game;
    };
    const { snapshot } = options;
    const loaded =
      snapshot && !options.record ? loadSnapshot(snapshot.bytes, BUILD, create) : undefined;
    if (snapshot && loaded?.ok) {
      this.game = loaded.game;
      this.history.push(...snapshot.history);
    } else {
      this.game = create();
    }
    this.snapshotRefused = loaded && !loaded.ok ? loaded.reason : undefined;
    this.players = players;
    this.botIds = botIds;
    this.nationIds = nationIds;
    this.difficulty = difficulty;
    this.online = options.players !== undefined && !options.record;
    if (options.record) {
      this.recorded = new Map(options.record.turns.map((turn) => [turn.tick, turn.orders]));
    }
    this.depth = new Uint16Array(grid.size);
    let ownable = 0;
    for (let tile = 0; tile < grid.size; tile++) if (terrain.isOwnable(tile)) ownable++;
    this.ownableTiles = ownable;
  }

  /** The game as it stands, to start from after a reload (#39). */
  snapshot(): GameSnapshot {
    return {
      tick: this.game.tick,
      bytes: saveSnapshot(this.game, BUILD),
      history: [...this.history],
    };
  }

  /** Lowest id of the nations, or one past the last player when there are none. */
  get firstNation(): number {
    return this.nationIds[0] ?? Math.max(...this.players.map((player) => player.id)) + 1;
  }

  get winner(): number | undefined {
    return this.game.winner;
  }

  /** Team of each player by id, 0 for none; empty in a free-for-all (R-MODE-02). */
  teamsById(): number[] {
    if (this.game.teams === 0) return [];
    const teams: number[] = [];
    for (const player of this.game.players()) teams[player.id] = player.team;
    return Array.from(teams, (team: number | undefined) => team ?? 0);
  }

  /**
   * What a click on `tile` means for the human now: pick a start during the
   * spawn phase, then expand or attack with `ratio` percent of their troops,
   * by land when the target touches their land, by sea when it is a coast
   * on another land mass. Otherwise, why nothing happens.
   */
  orderForClick(tile: number, ratio: number, mode: ClickMode = "attack"): ClickResult {
    const { game } = this;
    const { terrain, territory } = game;
    const human = game.player(this.you);
    if (!human?.alive || game.winner !== undefined) return { refused: "over" };
    if (!Number.isInteger(tile) || tile < 0 || tile >= terrain.topology.size) {
      return { refused: "terrain" };
    }
    if (mode === "demolish") return this.demolishNear(tile);
    if (mode === "warship") return this.warshipFor(tile);
    if (mode === "missile" || mode === "heavyMissile") {
      return this.missileAt(tile, mode === "heavyMissile");
    }
    if (mode === "port") return this.portNear(tile);
    if (!terrain.isOwnable(tile)) return { refused: "terrain" };
    if (
      game.phase === "play" &&
      isAllied(game, this.you, territory.ownerOf(tile)) &&
      mode === "attack"
    ) {
      return { refused: sameTeam(game, this.you, territory.ownerOf(tile)) ? "teammate" : "ally" };
    }
    if (
      mode === "city" ||
      mode === "palace" ||
      mode === "fort" ||
      mode === "silo" ||
      mode === "airDefense"
    ) {
      const order: Order = { type: "build", structure: STRUCTURE_KINDS[mode], tile };
      const error = orderError(game, human, order);
      if (error === undefined) return { order };
      // The tile was checked above: anything else is a placement rule.
      return { refused: isBuildError(error) ? BUILD_REFUSALS[error] : "terrain" };
    }
    if (game.phase === "spawn") return { order: { type: "spawn", tile } };
    if (territory.ownerOf(tile) === this.you) return { refused: "own" };
    const troops = Math.floor((human.troops * Math.min(100, Math.max(0, ratio))) / 100);
    if (troops < 1) return { refused: "troops" };

    // By land when the player borders the target's owner on the target's own
    // land mass: an attack starts from that border, so it must reach the click.
    const owner = territory.ownerOf(tile);
    const mass = terrain.landmassOf(tile);
    const around = new Int32Array(4);
    let touches = false;
    for (let i = 0; i < territory.borderCount(this.you) && !touches; i++) {
      const border = territory.borderTile(this.you, i);
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
    if (terrain.isCoast(tile) && seaRoute(game, this.you, tile)) {
      const atSea = game.boats.filter((boat) => boat.player === this.you).length;
      if (atSea >= game.balance.boatMax) return { refused: "ships" };
      return { order: { type: "embark", target: tile, troops } };
    }
    return { refused: "unreachable" };
  }

  /**
   * In port mode: a port on the player's coast tile closest to the click,
   * within PORT_REACH, among those that take one. When none does, the refusal
   * is the one of the closest coast tile, or "coast" when the player holds
   * no coast there.
   */
  private portNear(tile: number): ClickResult {
    const { game } = this;
    const { terrain, territory } = game;
    const human = game.player(this.you);
    if (!human) return { refused: "over" };
    const topology = terrain.topology;
    let refusal: { error: string; distance: number } | undefined;
    let best: { tile: number; distance: number } | undefined;
    for (const near of topology.tilesWithin(tile, PORT_REACH)) {
      if (territory.ownerOf(near) !== this.you || !terrain.isCoast(near)) continue;
      const distance = topology.squaredDistance(near, tile);
      const order: Order = { type: "build", structure: StructureKind.Port, tile: near };
      const error = orderError(game, human, order);
      if (error === undefined) {
        if (!best || distance < best.distance) best = { tile: near, distance };
      } else if (!refusal || distance < refusal.distance) {
        refusal = { error, distance };
      }
    }
    if (best) {
      const order: Order = { type: "build", structure: StructureKind.Port, tile: best.tile };
      return terrain.isOceanCoast(best.tile) ? { order } : { order, note: "lake" };
    }
    if (!refusal) {
      // No coast of the player's near: the click itself says why (the phase,
      // a left-out port, someone else's land), and on the sea, "coast".
      const error = orderError(game, human, {
        type: "build",
        structure: StructureKind.Port,
        tile,
      });
      return {
        refused: error !== undefined && isBuildError(error) ? BUILD_REFUSALS[error] : "coast",
      };
    }
    return { refused: isBuildError(refusal.error) ? BUILD_REFUSALS[refusal.error] : "terrain" };
  }

  /** In a missile mode: a launch at the tile clicked, land or not, from the closest loaded silo. */
  private missileAt(tile: number, heavy: boolean): ClickResult {
    const { game } = this;
    const human = game.player(this.you);
    if (!human) return { refused: "over" };
    if (!game.terrain.isOwnable(tile)) return { refused: "terrain" };
    const order: Order = {
      type: "missile",
      target: tile,
      size: heavy ? MissileSize.Heavy : MissileSize.Light,
    };
    const error = orderError(game, human, order);
    if (error === undefined) return { order };
    if (error === MissileError.Early) return { refused: "early" };
    if (error === MissileError.Ally) {
      return {
        refused: sameTeam(game, this.you, game.territory.ownerOf(tile)) ? "teammate" : "ally",
      };
    }
    if (error === MissileError.Near) return { refused: "allyNear" };
    if (error === MissileError.Gold) return { refused: "gold" };
    return { refused: "silo" };
  }

  /**
   * In warship mode: a click near the player's port buys a warship there; a
   * click on water sends the player's closest warship that can reach it to
   * patrol around it.
   */
  private warshipFor(tile: number): ClickResult {
    const { game } = this;
    const human = game.player(this.you);
    if (!human) return { refused: "over" };
    if (game.phase !== "play") return { refused: "early" };
    if (game.terrain.kind(tile) === TileKind.Water) {
      const topology = game.terrain.topology;
      const ships = game.warships
        .filter((warship) => warship.player === this.you)
        .map((warship) => ({ id: warship.id, distance: topology.distance(warship.tile, tile) }))
        .sort((a, b) => a.distance - b.distance);
      for (const { id } of ships) {
        const order: Order = { type: "patrol", ship: id, tile };
        if (orderError(game, human, order) === undefined) return { order };
      }
      return { refused: "noWarship" };
    }
    // A click near the port finds it, as far as a click that built it reaches.
    const port = this.structureNear(tile, (s) => s.kind === StructureKind.Port, PORT_REACH);
    if (!port) return { refused: "port" };
    const order: Order = { type: "warship", port: port.tile };
    const error = orderError(game, human, order);
    if (error === undefined) return { order };
    if (error === WarshipError.Max) return { refused: "warships" };
    if (error === WarshipError.Gold) return { refused: "gold" };
    if (error === WarshipError.Shore) return { refused: "shore" };
    if (error === WarshipError.Disabled) return { refused: "disabled" };
    return { refused: "port" };
  }

  private demolishNear(tile: number): ClickResult {
    const structure = this.structureNear(tile, () => true);
    return structure
      ? { order: { type: "demolish", tile: structure.tile } }
      : { refused: "nothing" };
  }

  /** The player's structure closest to the click and passing `accept`, within `reach` tiles. */
  private structureNear(
    tile: number,
    accept: (structure: Structure) => boolean,
    reach = DEMOLISH_REACH,
  ): Structure | undefined {
    const topology = this.game.terrain.topology;
    let best: Structure | undefined;
    let bestDistance = 0;
    for (const structure of this.game.structures) {
      if (structure.player !== this.you || !accept(structure)) continue;
      const distance = topology.distance(structure.tile, tile);
      if (distance <= reach && (!best || distance < bestDistance)) {
        best = structure;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Solo: runs one tick with the player's orders and returns what changed.
   * Once the game is decided the bots play on for spectators (R-WIN-03), and
   * the player's orders are dropped.
   */
  step(orders: readonly Order[]): GameUpdate {
    // The local relay: the turn the server would send, with this player's orders only.
    const turn: Turn = {
      tick: this.game.tick,
      orders:
        this.game.winner === undefined ? orders.map((order) => ({ player: this.you, order })) : [],
    };
    return this.playTurns([turn]);
  }

  /**
   * Online: runs turns relayed by the server, every player's orders in
   * them, and returns what changed over all of them. Hashes of the state
   * after every HASH_INTERVAL-th tick come with the update, for the server
   * to compare between players.
   */
  playTurns(turns: readonly Turn[]): GameUpdate {
    const hashes: { tick: number; hash: number }[] = [];
    for (const turn of turns) {
      this.game.step(turn);
      if (turn.orders.length > 0) this.history.push(turn);
      if (!this.online) continue;
      if (turn.tick % HASH_INTERVAL === 0) {
        const hash = this.game.hash();
        hashes.push({ tick: turn.tick, hash });
        this.hashes.push({ tick: turn.tick, local: hash });
      }
    }
    const update = this.update();
    if (hashes.length > 0) update.hashes = hashes;
    return update;
  }

  /**
   * Watching a recorded game: runs up to `ticks` more of it, with its own
   * turns, and stops at its last tick, where the hash it reaches should be
   * the one recorded.
   */
  replay(ticks: number): GameUpdate {
    const record = this.options.record;
    if (!record || !this.recorded) throw new Error("not a replay");
    const end = Math.min(record.ticks, this.game.tick + Math.max(0, Math.floor(ticks)));
    while (this.game.tick < end) {
      this.game.step({ tick: this.game.tick, orders: this.recorded.get(this.game.tick) ?? [] });
    }
    const update = this.update();
    update.replay = { ticks: record.ticks, expected: record.hash };
    if (this.game.tick >= record.ticks) update.replay.hash = this.game.hash();
    return update;
  }

  /**
   * The game so far, to watch again on this build (#50). Published maps
   * only, like a desync report; none while watching a replay.
   */
  record(): GameRecord | undefined {
    const { source } = this.map;
    if (!source || this.options.record) return undefined;
    return {
      version: GAME_RECORD_VERSION,
      build: { release: RELEASE, build: BUILD, protocol: PROTOCOL_VERSION },
      map: { id: this.map.id, ...source },
      seed: this.options.seed,
      balance: this.game.balance,
      players: this.players,
      bots: { ids: this.botIds, difficulty: this.difficulty },
      ...(this.nationIds.length > 0 ? { nations: this.nationIds } : {}),
      ...(this.game.teams > 0 ? { teams: this.game.teams } : {}),
      ...(this.game.disabled > 0 ? { disabled: this.game.disabled } : {}),
      you: this.you,
      ticks: this.game.tick,
      turns: this.history,
      hash: this.game.hash(),
    };
  }

  /** The server found this client's hash after `tick` differs from most players'. */
  desync(tick: number, expected: number | null): void {
    this.expected.set(tick, expected);
  }

  /**
   * Everything needed to replay this online game elsewhere and find where it
   * went apart (docs/engine.md, "Desync reports"). Published maps only: a
   * generated map has no terrain file to pin.
   */
  report(): DesyncReport | undefined {
    const { source } = this.map;
    if (!this.online || !source) return undefined;
    const first = Math.min(...this.expected.keys());
    return {
      version: DESYNC_REPORT_VERSION,
      build: { release: RELEASE, protocol: PROTOCOL_VERSION },
      map: { id: this.map.id, ...source },
      seed: this.options.seed,
      balance: this.game.balance,
      players: this.players,
      bots: { ids: this.botIds, difficulty: this.difficulty },
      ...(this.nationIds.length > 0 ? { nations: this.nationIds } : {}),
      ...(this.game.teams > 0 ? { teams: this.game.teams } : {}),
      ...(this.game.disabled > 0 ? { disabled: this.game.disabled } : {}),
      you: this.you,
      ticks: this.game.tick,
      turns: this.history,
      // Before the first desync the server had nothing to say: the hashes
      // matched. After it, a tick it did not flag is unknown.
      hashes: this.hashes.map(({ tick, local }) => ({
        tick,
        local,
        expected: this.expected.has(tick)
          ? (this.expected.get(tick) ?? null)
          : tick < first
            ? local
            : null,
      })),
    };
  }

  private diplomacy(): DiplomacyView {
    const { game, you } = this;
    const tick = game.tick;
    return {
      allies: alliesOf(game, you).map((id) => {
        const alliance = allianceOf(game, you, id);
        const until = alliance?.until ?? tick;
        return {
          id,
          ticksLeft: until - tick,
          renewable: alliance !== undefined && canRenew(game, alliance),
          renewing:
            alliance !== undefined && (you === alliance.a ? alliance.renewA : alliance.renewB),
        };
      }),
      teammates: game
        .players()
        .filter((player) => sameTeam(game, you, player.id))
        .map((player) => player.id),
      incoming: game.allianceRequests
        .filter((request) => request.to === you && tick < request.expiresAt)
        .map((request) => ({ from: request.from, ticksLeft: request.expiresAt - tick })),
      outgoing: game.allianceRequests
        .filter((request) => request.from === you && tick < request.expiresAt)
        .map((request) => request.to),
      waiting: game.requestCooldowns
        .filter((cooldown) => cooldown.from === you && tick < cooldown.until)
        .map((cooldown) => cooldown.to),
      traitors: game
        .players()
        .filter((player) => player.alive && tick < player.traitorUntil)
        .map((player) => ({ id: player.id, ticksLeft: player.traitorUntil - tick })),
      embargoes: game.embargoes.filter((e) => e.from === you).map((e) => e.to),
      embargoedBy: game.embargoes.filter((e) => e.to === you).map((e) => e.from),
      atWar: game
        .players()
        .filter((player) => player.alive && atWar(game, you, player.id))
        .map((player) => player.id),
      quickIn: Math.max(0, quickAllowedAt(game, you) - tick),
    };
  }

  /** What the engine logged between players since the last update, in order (R-DIPLO-04). */
  private diplomacyEvents(): DiplomacyEvent[] {
    return this.game.diplomacyEvents
      .splice(0)
      .map(({ type, a, b, phrase }) =>
        phrase === undefined ? { type, a, b } : { type, a, b, phrase },
      );
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
      you: this.you,
      tick: game.tick,
      phase: game.phase,
      spawnTicksLeft: Math.max(0, game.balance.spawnPhaseTicks - game.tick),
      players,
      attacks: game.attacks
        .filter((attack) => attack.player === this.you)
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
      tradeShips: game.tradeShips.map((ship) => ({
        id: ship.id,
        player: ship.player,
        tile: ship.path[Math.max(0, Math.min(ship.step, ship.path.length) - 1)] ?? ship.from,
      })),
      warships: game.warships.map((ship) => ({
        id: ship.id,
        player: ship.player,
        tile: ship.tile,
        health: ship.health,
      })),
      missiles: game.missiles.map((missile) => ({
        id: missile.id,
        player: missile.player,
        heavy: missile.size === MissileSize.Heavy,
        tile: missileTile(game, missile, game.tick),
        to: missile.to,
        target: territory.ownerOf(missile.to),
      })),
      fallout: game.fallout.map(({ tile, radius }) => ({ tile, radius })),
      structures: game.structures.map((structure) => ({
        id: structure.id,
        player: structure.player,
        type: STRUCTURE_TYPES[structure.kind],
        tile: structure.tile,
        ready: isReady(game, structure),
      })),
      build: {
        cityCost: structureCost(game, this.you, StructureKind.City),
        palaceCost: structureCost(game, this.you, StructureKind.Palace),
        fortCost: structureCost(game, this.you, StructureKind.Fort),
        portCost: structureCost(game, this.you, StructureKind.Port),
        warshipCost: warshipCost(game, this.you),
        siloCost: structureCost(game, this.you, StructureKind.Silo),
        airDefenseCost: structureCost(game, this.you, StructureKind.AirDefense),
        missileCost: missileCost(game, MissileSize.Light),
        heavyMissileCost: missileCost(game, MissileSize.Heavy),
        // Any tile will do: whether one is loaded does not depend on the target.
        loaded: launchSilo(game, this.you, 0) !== undefined,
        cities: cityShare(game, this.you),
        cityLimit: cityLimit(game, this.you),
      },
      diplomacy: this.diplomacy(),
      events: this.diplomacyEvents(),
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
    if (game.winningTeam !== undefined) update.winningTeam = game.winningTeam;
    return update;
  }
}
