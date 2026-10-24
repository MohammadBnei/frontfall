import type { Terrain } from "./terrain.ts";
import {
  DesyncReportError,
  readGame,
  readInteger,
  readObject,
  readText,
  recreateGame,
  type RecordedGame,
} from "./desync-report.ts";

/** Version of the record format below; a reader refuses any other. */
export const GAME_RECORD_VERSION = 1;

/**
 * A game kept to be watched again (#50): its setup, every turn with orders,
 * and the state hash it reached, which a replay must reach too. Bots and
 * nations are not recorded: they decide again from the same state. Plain
 * JSON, like a desync report, of which it is the setup and turns.
 */
export interface GameRecord extends RecordedGame {
  version: typeof GAME_RECORD_VERSION;
  /**
   * Build that played the game. Only the same build replays it: the engine
   * and the balance change from one to the next.
   */
  build: { release: string; build: string; protocol: number };
  /** State hash after `ticks` ticks. */
  hash: number;
}

/** Checks the shape of a parsed record, so a damaged file fails here rather than mid-replay. */
export function readGameRecord(value: unknown): GameRecord {
  const raw = readObject(value, "record");
  if (raw.version !== GAME_RECORD_VERSION) {
    throw new DesyncReportError(
      `unsupported record version ${String(raw.version)}, expected ${String(GAME_RECORD_VERSION)}`,
    );
  }
  const build = readObject(raw.build, "build");
  return {
    version: GAME_RECORD_VERSION,
    build: {
      release: readText(build.release, "build.release"),
      build: readText(build.build, "build.build"),
      protocol: readInteger(build.protocol, "build.protocol"),
    },
    ...readGame(raw),
    hash: readInteger(raw.hash, "hash"),
  };
}

/** Plays a recorded game to its last tick on `terrain`, the map it names, and returns the hash it reaches. */
export function replayGameRecord(game: GameRecord, terrain: Terrain): number {
  const replay = recreateGame(game, terrain);
  const turns = new Map(game.turns.map((turn) => [turn.tick, turn.orders]));
  while (replay.tick < game.ticks) {
    replay.step({ tick: replay.tick, orders: turns.get(replay.tick) ?? [] });
  }
  return replay.hash();
}
