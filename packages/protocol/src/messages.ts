import { z } from "zod";
import {
  DecodeError,
  decodeFrame,
  encodeOrderFrame,
  encodeTurnBody,
  encodeTurnsFrame,
} from "./binary.ts";
import { Order, PlayerNumber, type Turn } from "./orders.ts";

/**
 * Version of the messages below. A client and a server only talk when their
 * versions are equal; the `hello` message keeps its shape in every version so
 * that a mismatch can always be reported. Adding an order kind changes the
 * turn frames, so it bumps this version too; a test pins the order kinds of
 * the current version.
 */
export const PROTOCOL_VERSION = 4;

/** Ticks per second of the simulation. The server closes one turn per tick. */
export const TICK_RATE = 10;

/** Clients send a hash of their state after every tick that is a multiple of this. */
export const HASH_INTERVAL = 50;

/** Codes a server closes a WebSocket with, besides the standard 1000 to 1015. */
export const CloseCode = {
  /** The client speaks another protocol version: reload the page. */
  versionMismatch: 4000,
  /** A frame could not be decoded or broke the message rules. */
  invalidMessage: 4001,
  /** The client sent too many messages or orders. */
  rateLimited: 4002,
  /** The client stayed connected without playing for too long. */
  idle: 4003,
  /** Another connection took over this player. */
  replaced: 4004,
} as const;

/** Error codes of the `error` message. */
export const ErrorCode = z.enum([
  "invalid_name",
  "not_found",
  "game_full",
  "game_started",
  "already_in_game",
  "not_in_game",
  "not_host",
  "too_many_games",
  "token_invalid",
  "token_in_use",
  "invalid_settings",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Game ids and reconnect tokens: URL-safe base64. */
const gameId = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const tick = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const stateHash = z.number().int().min(0).max(0xffffffff);

/** How hard the bots play. Every client runs them at the level the game was set to. */
export const Difficulty = z.enum(["easy", "normal", "hard"]);
export type Difficulty = z.infer<typeof Difficulty>;

/** What the host of a private game chooses before the start. */
export const GameOptions = z
  .object({
    /** Id of a map in `maps/index.json`. */
    map: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .max(64),
    bots: z.number().int().min(0).max(255),
    difficulty: Difficulty,
  })
  .strict();
export type GameOptions = z.infer<typeof GameOptions>;

export const ClientMessage = z.discriminatedUnion("type", [
  /** First message of every connection. The name is checked by `normalizeName`. */
  z.object({
    type: z.literal("hello"),
    version: z.number().int(),
    name: z.string().max(64),
    /** Build of the page; the server turns away other builds, except "dev". */
    build: z.string().max(64).optional(),
  }),
  /** Join the public game that starts soonest, or open a new one. */
  z.object({ type: z.literal("play") }).strict(),
  /** Open a private game; the creator is its host. */
  z.object({ type: z.literal("create") }).strict(),
  /** Join a game by id, from the public list or an invite link. */
  z.object({ type: z.literal("join"), game: gameId }).strict(),
  /** Take back a seat after a dropped connection, receiving every turn from `from`. */
  z.object({ type: z.literal("rejoin"), token, from: tick }).strict(),
  /** Host only: change the map, bots or difficulty of a private game before it starts. */
  z.object({ type: z.literal("configure"), options: GameOptions }).strict(),
  /** Host only: start a private game now. */
  z.object({ type: z.literal("start") }).strict(),
  /** Leave the current game for good. */
  z.object({ type: z.literal("leave") }).strict(),
  /** Hash of the client's game state after running `tick`. */
  z.object({ type: z.literal("hash"), tick, hash: stateHash }).strict(),
  /** Sent as a binary frame. */
  z.object({ type: z.literal("order"), order: Order }).strict(),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

const PlayerInfo = z.object({ id: PlayerNumber, name: z.string() });
export type PlayerInfo = z.infer<typeof PlayerInfo>;

const Visibility = z.enum(["public", "private"]);

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome"), version: z.number().int() }),
  /** State of the game being filled. Sent again after every change. */
  z.object({
    type: z.literal("lobby"),
    game: gameId,
    visibility: Visibility,
    map: z.string(),
    bots: z.number().int().nonnegative(),
    difficulty: Difficulty,
    capacity: z.number().int().positive(),
    players: z.array(PlayerInfo),
    you: PlayerNumber,
    /** Only private games have a host. */
    host: PlayerNumber.nullable(),
    /** Milliseconds before the game starts, when a countdown runs. */
    startsIn: z.number().int().nonnegative().nullable(),
  }),
  /** The game starts, or the player rejoined it. Player numbers are final from here. */
  z.object({
    type: z.literal("started"),
    game: gameId,
    map: z.string(),
    seed: z.number().int().min(0).max(0x7fffffff),
    /** Bots that every client adds to the game and runs itself. */
    bots: z.number().int().nonnegative(),
    difficulty: Difficulty,
    tickRate: z.number().int().positive(),
    players: z.array(PlayerInfo),
    you: PlayerNumber,
    /** Secret that lets this player rejoin after a dropped connection. */
    token,
  }),
  /** Sent as a binary frame. Turns are consecutive. */
  z.object({
    type: z.literal("turns"),
    turns: z.array(
      z.object({ tick, orders: z.array(z.object({ player: PlayerNumber, order: Order })) }),
    ),
  }),
  /** This player's state hash for `tick` differed from the majority's, if any. */
  z.object({ type: z.literal("desync"), tick, hash: stateHash, expected: stateHash.nullable() }),
  /** The game is over for this connection, which may join another one. */
  z.object({
    type: z.literal("ended"),
    reason: z.enum(["abandoned", "timeout", "expired", "left"]),
  }),
  z.object({ type: z.literal("error"), code: ErrorCode, message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** A WebSocket payload: text for JSON messages, bytes for binary frames. */
export type Frame = string | Uint8Array;

function parseJson<T>(schema: z.ZodType<T>, raw: string, binaryType: string): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "malformed JSON" };
  }
  const result = schema.safeParse(json);
  if (!result.success) return { ok: false, error: z.prettifyError(result.error) };
  if ((result.data as { type: string }).type === binaryType) {
    return { ok: false, error: `${binaryType} must be sent as a binary frame` };
  }
  return { ok: true, value: result.data };
}

function decodeBinary<T>(bytes: Uint8Array, expected: "order" | "turns"): ParseResult<T> {
  try {
    const frame = decodeFrame(bytes);
    if (frame.kind !== expected) return { ok: false, error: `unexpected ${frame.kind} frame` };
    const value =
      frame.kind === "order"
        ? { type: "order", order: frame.order }
        : { type: "turns", turns: frame.turns };
    return { ok: true, value: value as T };
  } catch (error) {
    if (error instanceof DecodeError) return { ok: false, error: error.message };
    throw error;
  }
}

export function encodeClientMessage(message: ClientMessage): Frame {
  return message.type === "order" ? encodeOrderFrame(message.order) : JSON.stringify(message);
}

export function parseClientMessage(frame: Frame): ParseResult<ClientMessage> {
  return typeof frame === "string"
    ? parseJson(ClientMessage, frame, "order")
    : decodeBinary(frame, "order");
}

export function encodeServerMessage(message: ServerMessage): Frame {
  if (message.type !== "turns") return JSON.stringify(message);
  const from = message.turns[0]?.tick ?? 0;
  return encodeTurnsFrame(
    from,
    message.turns.map((turn: Turn, index) => {
      if (turn.tick !== from + index) throw new RangeError("turns must be consecutive");
      return encodeTurnBody(turn.orders);
    }),
  );
}

export function parseServerMessage(frame: Frame): ParseResult<ServerMessage> {
  return typeof frame === "string"
    ? parseJson(ServerMessage, frame, "turns")
    : decodeBinary(frame, "turns");
}
