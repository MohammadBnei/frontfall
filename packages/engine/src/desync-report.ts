import { DEFAULT_BALANCE, type Balance } from "./balance.ts";
import { BOT_DIFFICULTIES, installBots, type BotDifficulty } from "./bots/index.ts";
import { createGame } from "./create-game.ts";
import type { Order, PlayerSetup, Turn } from "./game.ts";
import type { Terrain } from "./terrain.ts";

/** Version of the report format below; a reader refuses any other. */
export const DESYNC_REPORT_VERSION = 1;

/**
 * Everything needed to play a game again, tick for tick, and the state
 * hashes one client saw along the way. A client writes it when its hash
 * disagrees with the other players' (R-FAIR-01); `pnpm sim --replay` reads it
 * back. Plain JSON: hashes are unsigned 32-bit integers, tiles are indices.
 */
export interface DesyncReport {
  version: typeof DESYNC_REPORT_VERSION;
  /** Build that wrote the report: the release name and PROTOCOL_VERSION it spoke. */
  build: { release: string; protocol: number };
  /** A published map, pinned by the hash of its terrain file. */
  map: { id: string; format: number; version: number; sha256: string };
  seed: number;
  /** Every balance value the game ran with, not only those that differ from the defaults. */
  balance: Balance;
  /** Every player in the game, humans and bots, with the ids the game used. */
  players: PlayerSetup[];
  bots: { ids: number[]; difficulty: BotDifficulty };
  /** The player whose client wrote the report. */
  you: number;
  /** Ticks the client had run; turns and hashes come from ticks below this. */
  ticks: number;
  /** Turns with at least one order, by increasing tick; any other tick ran without orders. */
  turns: Turn[];
  /**
   * The client's hash after each checked tick, with the hash most other
   * players reported for it, or null when the server had none to compare.
   */
  hashes: { tick: number; local: number; expected: number | null }[];
}

export interface ReplayResult {
  /** Ticks run, at most `report.ticks`. */
  ticks: number;
  /** First checked tick where this replay disagrees with the client's own hash: the engine is not deterministic. */
  firstLocalMismatch: { tick: number; replay: number; local: number } | undefined;
  /** First checked tick where the client disagreed with the other players: where the desync began. */
  firstDesync: { tick: number; local: number; expected: number } | undefined;
}

/** Plays the reported game on `terrain`, which must be the map the report names. */
export function replayDesyncReport(report: DesyncReport, terrain: Terrain): ReplayResult {
  const game = createGame({
    terrain,
    seed: report.seed,
    players: report.players,
    balance: report.balance,
  });
  installBots(game, report.bots.ids, report.bots.difficulty);
  const turns = new Map(report.turns.map((turn) => [turn.tick, turn.orders]));
  const hashes = new Map(report.hashes.map((entry) => [entry.tick, entry]));
  let firstLocalMismatch: ReplayResult["firstLocalMismatch"];
  let firstDesync: ReplayResult["firstDesync"];
  while (game.tick < report.ticks) {
    const tick = game.tick;
    game.step({ tick, orders: turns.get(tick) ?? [] });
    const seen = hashes.get(tick);
    if (!seen) continue;
    const replay = game.hash();
    if (!firstLocalMismatch && replay !== seen.local) {
      firstLocalMismatch = { tick, replay, local: seen.local };
    }
    if (!firstDesync && seen.expected !== null && seen.expected !== seen.local) {
      firstDesync = { tick, local: seen.local, expected: seen.expected };
    }
  }
  return { ticks: game.tick, firstLocalMismatch, firstDesync };
}

/** Checks the shape of a parsed report, so a damaged file fails here rather than mid-replay. */
export function readDesyncReport(value: unknown): DesyncReport {
  const report = record(value, "report");
  if (report.version !== DESYNC_REPORT_VERSION) {
    throw new DesyncReportError(
      `unsupported report version ${String(report.version)}, expected ${String(DESYNC_REPORT_VERSION)}`,
    );
  }
  const build = record(report.build, "build");
  const map = record(report.map, "map");
  const balance = record(report.balance, "balance");
  for (const key of Object.keys(DEFAULT_BALANCE) as (keyof Balance)[]) {
    const expected = DEFAULT_BALANCE[key];
    const actual = balance[key];
    const ok = Array.isArray(expected)
      ? Array.isArray(actual) &&
        actual.length === expected.length &&
        actual.every((entry) => Number.isSafeInteger(entry))
      : Number.isSafeInteger(actual);
    if (!ok) throw new DesyncReportError(`invalid balance ${key}`);
  }
  const bots = record(report.bots, "bots");
  const difficulty = bots.difficulty;
  if (typeof difficulty !== "string" || !Object.hasOwn(BOT_DIFFICULTIES, difficulty)) {
    throw new DesyncReportError(`unknown bot difficulty ${String(difficulty)}`);
  }
  return {
    version: DESYNC_REPORT_VERSION,
    build: {
      release: text(build.release, "build.release"),
      protocol: integer(build.protocol, "build.protocol"),
    },
    map: {
      id: text(map.id, "map.id"),
      format: integer(map.format, "map.format"),
      version: integer(map.version, "map.version"),
      sha256: text(map.sha256, "map.sha256"),
    },
    seed: integer(report.seed, "seed"),
    balance: balance as unknown as Balance,
    players: list(report.players, "players").map((entry, i) => {
      const player = record(entry, `players[${String(i)}]`);
      return { id: integer(player.id, "player id"), name: text(player.name, "player name") };
    }),
    bots: {
      ids: list(bots.ids, "bots.ids").map((id) => integer(id, "bot id")),
      difficulty: difficulty as BotDifficulty,
    },
    you: integer(report.you, "you"),
    ticks: integer(report.ticks, "ticks"),
    turns: list(report.turns, "turns").map((entry, i) => {
      const turn = record(entry, `turns[${String(i)}]`);
      return {
        tick: integer(turn.tick, "turn tick"),
        orders: list(turn.orders, "turn orders").map((item) => {
          const sent = record(item, "order");
          return { player: integer(sent.player, "order player"), order: order(sent.order) };
        }),
      };
    }),
    hashes: list(report.hashes, "hashes").map((entry) => {
      const hash = record(entry, "hash");
      return {
        tick: integer(hash.tick, "hash tick"),
        local: integer(hash.local, "local hash"),
        expected: hash.expected === null ? null : integer(hash.expected, "expected hash"),
      };
    }),
  };
}

export class DesyncReportError extends Error {
  override name = "DesyncReportError";
}

function order(value: unknown): Order {
  const raw = record(value, "order");
  switch (raw.type) {
    case "spawn":
      return { type: "spawn", tile: integer(raw.tile, "spawn tile") };
    case "attack":
    case "embark":
      return {
        type: raw.type,
        target: integer(raw.target, "order target"),
        troops: integer(raw.troops, "order troops"),
      };
    case "retreat":
      return { type: "retreat", attack: integer(raw.attack, "retreat attack") };
    default:
      throw new DesyncReportError(`unknown order type ${String(raw.type)}`);
  }
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DesyncReportError(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new DesyncReportError(`${what} is not a list`);
  return value;
}

function integer(value: unknown, what: string): number {
  if (!Number.isSafeInteger(value)) throw new DesyncReportError(`${what} is not an integer`);
  return value as number;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string") throw new DesyncReportError(`${what} is not a string`);
  return value;
}
