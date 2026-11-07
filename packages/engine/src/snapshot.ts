import type { Game } from "./game.ts";
import { SnapshotError, SnapshotReader, SnapshotWriter, checksum } from "./snapshot-bytes.ts";
import {
  optional,
  readInto,
  readList,
  tile,
  writeList,
  writeRecord,
  type Codec,
} from "./state/codec.ts";
import { writable, type GameLists } from "./state/lists.ts";
import {
  ALLIANCE_RECORD,
  ALLIANCE_REQUEST_RECORD,
  ATTACK_RECORD,
  BOAT_RECORD,
  EMBARGO_RECORD,
  FALLOUT_RECORD,
  FIGHT_RECORD,
  MISSILE_RECORD,
  PLAYER_RECORD,
  QUICK_COOLDOWN_RECORD,
  REQUEST_COOLDOWN_RECORD,
  STRUCTURE_RECORD,
  TRADE_SHIP_RECORD,
  WARSHIP_RECORD,
} from "./state/records.ts";

/** Version of the snapshot format of docs/engine.md; a reader refuses any other. */
export const SNAPSHOT_FORMAT = 5;

/**
 * Most bytes a snapshot may take. The state grows with the map and how
 * divided it is, not with time: on World, snapshots of whole games with 16
 * bots stay under 110 KB, and under 170 KB with the 64 nations added.
 */
export const SNAPSHOT_MAX_BYTES = 1024 * 1024;

/** "FFSN": what a snapshot starts with, so another file is refused on its first bytes. */
const MAGIC = [0x46, 0x46, 0x53, 0x4e] as const;

/** What a snapshot says about itself, read before any of the state. */
export interface SnapshotHeader {
  format: number;
  /** Build of the simulation that wrote it; only the same build loads it. */
  build: string;
  /** `setupDigest()` of the game it was taken from. */
  setup: number;
  /** Ticks the game had run; the next turn to play is this one. */
  tick: number;
  /** State hash of the game at that tick, which the loaded game must have. */
  hash: number;
  /** `checksum` of the state's bytes, which follow the header. */
  check: number;
}

export type LoadedSnapshot = { ok: true; game: Game } | { ok: false; reason: string };

/**
 * The whole state of a game between two ticks (#39), in the binary format
 * of docs/engine.md. `build` names the simulation that runs it: a client's
 * BUILD, the same on every runtime of a release.
 */
export function saveSnapshot(game: Game, build: string): Uint8Array {
  const out = new SnapshotWriter();
  for (const byte of MAGIC) out.uint(byte);
  out.uint(SNAPSHOT_FORMAT);
  out.text(build);
  out.word(game.setupDigest());
  out.uint(game.tick);
  out.word(game.hash());
  const state = new SnapshotWriter();
  writeState(game, state);
  const bytes = state.finish();
  out.word(checksum(bytes));
  out.raw(bytes);
  return out.finish();
}

/**
 * The header of a snapshot, or undefined if the bytes are not one of this
 * format. Reads nothing of the state.
 */
export function readSnapshotHeader(bytes: Uint8Array): SnapshotHeader | undefined {
  try {
    return header(new SnapshotReader(bytes));
  } catch {
    return undefined;
  }
}

/**
 * Loads a snapshot into the game `create` returns, which must be new and set
 * up like the one it was taken from: same setup, same rules, same bots and
 * nations. The build, the setup and the rules are checked before any of the
 * state is read, and the loaded state must hash as the saved one did.
 * Never throws: a snapshot that cannot be loaded comes back with the reason,
 * and the caller plays the turns from the start instead.
 */
export function loadSnapshot(bytes: Uint8Array, build: string, create: () => Game): LoadedSnapshot {
  try {
    if (bytes.length > SNAPSHOT_MAX_BYTES) return refuse("snapshot too large");
    const from = new SnapshotReader(bytes);
    const head = header(from);
    if (!head) return refuse("not a snapshot of this format");
    if (head.build !== build) return refuse(`snapshot of build ${head.build}, not ${build}`);
    const game = create();
    if (game.tick !== 0) return refuse("the game has already started");
    if (game.setupDigest() !== head.setup) return refuse("snapshot of another game setup");
    const bytesOfState = from.rest();
    if (checksum(bytesOfState) !== head.check) return refuse("damaged snapshot");
    const state = new SnapshotReader(bytesOfState);
    readState(game, head.tick, state);
    if (!state.done) return refuse("bytes after the end of the state");
    if (game.hash() !== head.hash) return refuse("loaded state does not hash as saved");
    return { ok: true, game };
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "unreadable snapshot");
  }
}

function refuse(reason: string): LoadedSnapshot {
  return { ok: false, reason };
}

function header(from: SnapshotReader): SnapshotHeader | undefined {
  for (const byte of MAGIC) if (from.uint() !== byte) return undefined;
  const format = from.uint();
  if (format !== SNAPSHOT_FORMAT) return undefined;
  const build = from.text();
  const setup = from.word();
  const tick = from.uint();
  return { format, build, setup, tick, hash: from.word(), check: from.word() };
}

/** The game's own counters of ids, which come before the list they number. */
type NextId =
  | "nextAttackId"
  | "nextBoatId"
  | "nextStructureId"
  | "nextTradeShipId"
  | "nextWarshipId"
  | "nextMissileId";

interface ListLayout {
  readonly list: keyof GameLists;
  /** The codec of the list's records, which `layout` matched to the list. */
  readonly codec: Codec<object>;
  readonly next?: NextId;
}

function layout<K extends keyof GameLists>(
  list: K,
  codec: Codec<GameLists[K][number]>,
  next?: NextId,
): ListLayout {
  const erased = codec as unknown as Codec<object>;
  return next === undefined ? { list, codec: erased } : { list, codec: erased, next };
}

/**
 * The entity lists in the order a snapshot holds them, each behind the
 * counter of its ids when it has one. Their records follow their codecs
 * (state/records.ts).
 */
const LISTS: readonly ListLayout[] = [
  layout("attacks", ATTACK_RECORD, "nextAttackId"),
  layout("boats", BOAT_RECORD, "nextBoatId"),
  layout("structures", STRUCTURE_RECORD, "nextStructureId"),
  layout("tradeShips", TRADE_SHIP_RECORD, "nextTradeShipId"),
  layout("warships", WARSHIP_RECORD, "nextWarshipId"),
  layout("missiles", MISSILE_RECORD, "nextMissileId"),
  layout("fallout", FALLOUT_RECORD),
  layout("fights", FIGHT_RECORD),
  layout("alliances", ALLIANCE_RECORD),
  layout("allianceRequests", ALLIANCE_REQUEST_RECORD),
  layout("requestCooldowns", REQUEST_COOLDOWN_RECORD),
  layout("embargoes", EMBARGO_RECORD),
  layout("quickCooldowns", QUICK_COOLDOWN_RECORD),
];

function writeState(game: Game, out: SnapshotWriter): void {
  // As they are: the generator keeps some words signed, and the state hash sees the difference.
  for (const word of game.random.state()) out.int(word);
  for (const p of game.players()) writeRecord(out, PLAYER_RECORD, p, game);

  const { territory } = game;
  writeRuns(out, territory.owners);
  for (let player = 1; player <= territory.maxPlayers; player++) {
    const count = territory.borderCount(player);
    out.uint(count);
    for (let i = 0; i < count; i++) out.uint(territory.borderTile(player, i));
  }
  writeRuns(out, game.falloutUntil);

  for (const { list, codec, next } of LISTS) {
    if (next !== undefined) out.uint(game[next]);
    writeList(out, codec, game[list] as readonly object[], game);
  }
  out.int(game.winner ?? -1);
  out.int(game.winningTeam ?? -1);
  out.int(game.decidedAt ?? -1);

  const parts = game.persistedParts();
  out.uint(parts.length);
  for (const { name, part } of parts) {
    out.text(name);
    const inner = new SnapshotWriter();
    part.save(inner);
    out.blob(inner.finish());
  }
}

function readState(game: Game, tick: number, from: SnapshotReader): void {
  const size = game.terrain.topology.size;
  const { territory } = game;

  game.restoreTick(tick);
  const word = (): number => {
    const value = from.int();
    if (value < -(2 ** 31) || value >= 2 ** 32)
      throw new SnapshotError("random state out of range");
    return value;
  };
  game.random.restore([word(), word(), word(), word()]);
  for (const p of game.players()) readInto(from, PLAYER_RECORD, p, game);

  const owners = new Uint16Array(size);
  readRuns(from, owners, territory.maxPlayers + 1);
  const borders: Int32Array[] = [];
  for (let p = 1; p <= territory.maxPlayers; p++) {
    const list = new Int32Array(from.count());
    for (let i = 0; i < list.length; i++) list[i] = tile.read(from, game);
    borders.push(list);
  }
  territory.restore(owners, borders);
  readRuns(from, game.falloutUntil, 2 ** 32);

  // The loader is the one module besides their owners that writes the lists (ADR 0010).
  for (const { list, codec, next } of LISTS) {
    if (next !== undefined) game[next] = from.uint();
    readList(from, codec, writable(game, list) as object[], game);
  }
  game.winner = optional.read(from, game);
  game.winningTeam = optional.read(from, game);
  game.decidedAt = optional.read(from, game);

  const parts = game.persistedParts();
  if (from.uint() !== parts.length) throw new SnapshotError("snapshot of other rules");
  for (const { name, part } of parts) {
    if (from.text() !== name) throw new SnapshotError("snapshot of other rules");
    const inner = new SnapshotReader(from.blob());
    part.load(inner);
    if (!inner.done) throw new SnapshotError(`bytes after the end of part ${name}`);
  }
}

/** An array as runs of equal values: land and sea come in long stretches. */
function writeRuns(out: SnapshotWriter, values: Uint16Array | Uint32Array): void {
  const runs: number[] = [];
  let start = 0;
  for (let i = 1; i <= values.length; i++) {
    if (i < values.length && values[i] === values[start]) continue;
    runs.push(values[start] as number, i - start);
    start = i;
  }
  out.uint(runs.length / 2);
  for (const value of runs) out.uint(value);
}

function readRuns(from: SnapshotReader, into: Uint16Array | Uint32Array, limit: number): void {
  let at = 0;
  for (let n = from.count(); n > 0; n--) {
    const value = from.below(limit, "value");
    const length = from.uint();
    if (length === 0 || length > into.length - at) throw new SnapshotError("runs do not fit");
    into.fill(value, at, at + length);
    at += length;
  }
  if (at !== into.length) throw new SnapshotError("runs do not fit");
}
