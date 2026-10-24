import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CloseCode,
  encodeServerMessage,
  normalizeName,
  parseClientMessage,
  PROTOCOL_VERSION,
  TICK_RATE,
  type ClientMessage,
  type ErrorCode,
  type Frame,
  type GameOptions,
} from "@frontfall/protocol";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { loadMapLimits, type MapLimits } from "./catalog.ts";
import { Directory } from "./directory.ts";
import { addressPseudonym, silentLogger, type Logger } from "./log.ts";
import { Metrics, type Snapshot } from "./metrics.ts";
import { clientAddress, isLocalRequest } from "./address.ts";
import { isAllowedOrigin } from "./origin.ts";
import { TokenBucket } from "./rate-limit.ts";
import type { Peer, Room, RoomObserver, RoomSettings, Seat } from "./room.ts";
import { loadStaticFile } from "./static-files.ts";

type GameSettings = Omit<RoomSettings, "visibility">;

export interface ServerOptions {
  /** Directory of the built client. */
  staticRoot: string;
  /** Only WebSockets opened by pages of this origin are accepted. Unset accepts any. */
  allowedOrigin?: string | undefined;
  /** Build identifier, returned by /healthz so a deployment can be checked. */
  version: string;
  pingIntervalMs?: number;
  maxConnectionsPerAddress?: number;
  /** Open WebSockets the whole server accepts. */
  maxConnections?: number;
  /** Private games not yet started that one address may hold. */
  maxPrivateGamesPerAddress?: number;
  maxRooms?: number;
  /** Bots the host of a private game may add, within the map's player count. */
  maxBots?: number;
  /** /healthz fails once no turn has been closed for this long. */
  stallAfterMs?: number;
  /** A connection must say hello within this delay. */
  helloTimeoutMs?: number;
  /** A connection whose seat is claimed must answer a ping within this delay. */
  probeTimeoutMs?: number;
  /** A connection that is in no game for this long is closed. */
  idleTimeoutMs?: number;
  /** Messages a connection may send per second on average, and at once. */
  messageRate?: { perSecond: number; burst: number };
  publicGame?: Partial<GameSettings>;
  privateGame?: Partial<GameSettings>;
  logger?: Logger;
}

export interface GameServer {
  readonly http: Server;
  readonly games: Directory;
  readonly metrics: Metrics;
  /** Tells every player the server is restarting, then stops accepting requests. */
  close(): Promise<void>;
}

/** Cloudflare drops a WebSocket that stays silent for 100 s. */
const DEFAULT_PING_INTERVAL_MS = 25_000;

/** Largest frame a client may send. Orders take a few bytes, hello a few dozen. */
const MAX_PAYLOAD_BYTES = 1024;

export const DEFAULT_GAME: GameSettings = {
  map: "world",
  capacity: 16,
  bots: 0,
  difficulty: "normal",
  nations: true,
  teams: 0,
  disabled: 0,
  minPlayers: 2,
  countdownMs: 30_000,
  reconnectGraceMs: 120_000,
  maxDurationMs: 4 * 60 * 60 * 1000,
  lobbyTimeoutMs: 10 * 60 * 1000,
  maxOrdersPerTurn: 10,
  maxLogBytes: 64 * 1024 * 1024,
};

/** WebSocket close reasons are capped at 123 bytes of UTF-8; ws throws on longer ones. */
const MAX_CLOSE_REASON_BYTES = 123;

/**
 * Cuts a reason to fit a close frame, on a character boundary. Decoding errors
 * quote what the client sent, which may be anything.
 */
export function closeReason(text: string): string {
  let reason = "";
  let bytes = 0;
  for (const char of text) {
    bytes += Buffer.byteLength(char);
    if (bytes > MAX_CLOSE_REASON_BYTES) break;
    reason += char;
  }
  return reason;
}

function toFrame(data: RawData, isBinary: boolean): Frame {
  const bytes = Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  return isBinary
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes.toString("utf8");
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  invalid_name: "the name is not allowed",
  not_found: "no such game",
  game_full: "the game is full",
  game_started: "the game has already started",
  already_in_game: "leave the current game first",
  not_in_game: "you are not in a game",
  not_host: "only the host can change or start the game",
  too_many_games: "too many games in progress",
  token_invalid: "this game is over or the seat was given up",
  token_in_use: "the seat is still connected",
  invalid_settings: "no such map, or too many bots for it",
};

/**
 * Seats a private game keeps with these options: the usual number, fewer on a
 * small map or with many bots, never fewer than the players already in. Bots
 * beyond the server's cap or that leave no seat for them give undefined.
 */
function seatsFor(
  options: GameOptions,
  maps: MapLimits,
  maxBots: number,
  usualSeats: number,
  players: number,
): number | undefined {
  const maxPlayers = maps.get(options.map);
  if (maxPlayers === undefined || options.bots > maxBots) return undefined;
  const seats = Math.min(usualSeats, maxPlayers - options.bots);
  return seats >= Math.max(players, 1) ? seats : undefined;
}

/** What one WebSocket connection has done so far. */
interface Session {
  readonly socket: WebSocket;
  readonly peer: Peer;
  /** Address of the player, for per-address limits. Never logged. */
  readonly address: string;
  /** Pseudonym of the client address, for the logs. */
  readonly client: string;
  readonly messages: TokenBucket;
  name: string | undefined;
  room: Room | undefined;
  seat: Seat | undefined;
  /** Since when the connection has been in no game. */
  idleSince: number | undefined;
  /** Rejected: whatever else it sends is dropped. */
  closing: boolean;
}

export function createGameServer(options: ServerOptions): GameServer {
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const maxConnectionsPerAddress = options.maxConnectionsPerAddress ?? 8;
  const maxConnections = options.maxConnections ?? 5_000;
  const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
  const probeTimeoutMs = options.probeTimeoutMs ?? 5_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
  const messageRate = options.messageRate ?? { perSecond: 20, burst: 40 };
  const stallAfterMs = options.stallAfterMs ?? 5000;
  /** End of the last pass of the turn timer, and whether close() has begun. */
  let lastTurnAt = performance.now();
  let stopping = false;
  const logger = options.logger ?? silentLogger;
  const pseudonym = addressPseudonym();
  const metrics = new Metrics();

  const observer: RoomObserver = {
    started(room) {
      metrics.gamesStarted.inc();
      logger.info("game_started", {
        game: room.id,
        visibility: room.settings.visibility,
        players: room.playerCount,
      });
    },
    finished(room, reason) {
      metrics.gamesFinished.inc({ reason });
      logger.info("game_finished", { game: room.id, reason, ticks: room.log.length });
    },
    desync(room, tick, hash, expected) {
      metrics.desyncs.inc();
      logger.warn("desync", { game: room.id, tick, hash, expected: expected ?? null });
    },
  };
  const privateGame = { ...DEFAULT_GAME, ...options.privateGame };
  const maps = loadMapLimits(options.staticRoot, privateGame.map);
  const maxBots = options.maxBots ?? 25;
  const games = new Directory({
    maxRooms: options.maxRooms ?? 500,
    maxPrivatePerOwner: options.maxPrivateGamesPerAddress ?? 3,
    publicGame: { ...DEFAULT_GAME, ...options.publicGame },
    privateGame,
    observer,
  });
  /** When the oldest ping a socket has not answered yet was sent. */
  const unanswered = new WeakMap<WebSocket, number>();
  const ping = (socket: WebSocket, now: number): void => {
    if (!unanswered.has(socket)) unanswered.set(socket, now);
    socket.ping();
  };
  const connectionsByAddress = new Map<string, number>();

  const http = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/healthz") {
      // An event loop that is blocked cannot answer at all; this catches a turn
      // timer that has stopped or fallen far behind while requests still get through.
      const status = stopping
        ? "stopping"
        : performance.now() - lastTurnAt > stallAfterMs
          ? "stalled"
          : "ok";
      response
        .writeHead(status === "ok" ? 200 : 503, {
          "content-type": "text/plain",
          "cache-control": "no-store",
          "x-frontfall-version": options.version,
        })
        .end(status);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    if (path === "/api/games") {
      sendJson(response, { games: games.publicGames(Date.now()) });
      return;
    }
    if (path === "/metrics" && isLocalRequest(request)) {
      response
        .writeHead(200, {
          "content-type": "text/plain; version=0.0.4",
          "cache-control": "no-store",
        })
        .end(metrics.render(snapshot()));
      return;
    }
    void loadStaticFile(options.staticRoot, path).then((file) => {
      if (!file) {
        response.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      const gzip = file.gzip && acceptsGzip(request) ? file.gzip : undefined;
      const caching = {
        etag: file.etag,
        // Built assets carry a content hash in their name; the page itself must stay fresh.
        "cache-control": path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      };
      if (matchesEtag(request.headers["if-none-match"], file.etag)) {
        response.writeHead(304, caching).end();
        return;
      }
      response.writeHead(200, {
        ...caching,
        "content-type": file.contentType,
        "x-content-type-options": "nosniff",
        "content-length": (gzip ?? file.body).length,
        ...(file.gzip && { vary: "Accept-Encoding" }),
        ...(gzip && { "content-encoding": "gzip" }),
      });
      if (request.method === "HEAD") response.end();
      else response.end(gzip ?? file.body);
    });
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  http.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== "/ws" || !isAllowedOrigin(request.headers.origin, options.allowedOrigin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    if (sockets.clients.size >= maxConnections) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      return;
    }
    const address = clientAddress(request);
    const connections = connectionsByAddress.get(address) ?? 0;
    if (connections >= maxConnectionsPerAddress) {
      socket.end("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      return;
    }
    connectionsByAddress.set(address, connections + 1);
    sockets.handleUpgrade(request, socket, head, (ws) => {
      ws.on("close", () => {
        const remaining = (connectionsByAddress.get(address) ?? 1) - 1;
        if (remaining > 0) connectionsByAddress.set(address, remaining);
        else connectionsByAddress.delete(address);
      });
      sockets.emit("connection", ws, request);
    });
  });

  function reply(session: Session, code: ErrorCode, message = ERROR_TEXT[code]): void {
    session.peer.send(encodeServerMessage({ type: "error", code, message }));
  }

  /** Closes a connection that broke the rules, and records why. */
  function reject(session: Session, code: number, reason: string, label: string): void {
    if (session.closing) return;
    session.closing = true;
    metrics.rejected.inc({ reason: label });
    logger.warn("connection_rejected", { client: session.client, reason: label });
    session.socket.close(code, closeReason(reason));
  }

  /** The seat of this connection, if it still holds one in a game. */
  function seatOf(session: Session): { room: Room; seat: Seat } | undefined {
    const { room, seat } = session;
    if (!room || !seat || !room.holds(seat) || seat.peer !== session.peer) return undefined;
    return { room, seat };
  }

  function enter(session: Session, room: Room | undefined, missing: ErrorCode): void {
    if (!room) {
      reply(session, missing);
      return;
    }
    const seat = room.join(session.name ?? "", session.peer, Date.now());
    if (typeof seat === "string") {
      reply(session, seat);
      return;
    }
    session.room = room;
    session.seat = seat;
    session.idleSince = undefined;
  }

  function handle(session: Session, message: ClientMessage): void {
    if (message.type === "hello") {
      if (session.name !== undefined) {
        reject(session, CloseCode.invalidMessage, "hello was already sent", "invalid");
        return;
      }
      if (message.build && !sameBuild(message.build, options.version)) {
        session.socket.close(CloseCode.versionMismatch, `build ${options.version} required`);
        return;
      }
      if (message.version !== PROTOCOL_VERSION) {
        session.socket.close(
          CloseCode.versionMismatch,
          `protocol ${String(PROTOCOL_VERSION)} required`,
        );
        return;
      }
      const name = normalizeName(message.name);
      if (!name.ok) {
        reply(session, "invalid_name", name.error);
        return;
      }
      session.name = name.name;
      session.idleSince = Date.now();
      session.peer.send(encodeServerMessage({ type: "welcome", version: PROTOCOL_VERSION }));
      return;
    }
    if (session.name === undefined) {
      reject(session, CloseCode.invalidMessage, "hello must come first", "invalid");
      return;
    }

    const current = seatOf(session);
    switch (message.type) {
      case "play":
      case "create":
      case "join":
      case "rejoin":
        if (current) {
          reply(session, "already_in_game");
          return;
        }
        if (message.type === "play") enter(session, games.quickMatch(), "too_many_games");
        else if (message.type === "create")
          enter(session, games.create("private", session.address), "too_many_games");
        else if (message.type === "join") enter(session, games.find(message.game), "not_found");
        else rejoin(session, message.token, message.from);
        return;
      case "configure": {
        const seats =
          current &&
          seatsFor(message.options, maps, maxBots, privateGame.capacity, current.room.playerCount);
        const error = !current
          ? "not_in_game"
          : seats === undefined
            ? "invalid_settings"
            : current.room.configure(
                current.seat,
                { ...message.options, capacity: seats },
                Date.now(),
              );
        if (error) reply(session, error);
        return;
      }
      case "start": {
        const error = current ? current.room.requestStart(current.seat, Date.now()) : "not_in_game";
        if (error) reply(session, error);
        return;
      }
      case "leave":
        if (!current) return;
        current.room.leave(current.seat, Date.now());
        session.room = undefined;
        session.seat = undefined;
        session.idleSince = Date.now();
        session.peer.send(encodeServerMessage({ type: "ended", reason: "left" }));
        games.sweep();
        return;
      case "hash":
        current?.room.reportHash(current.seat, message.tick, message.hash);
        return;
      case "order":
        current?.room.submit(current.seat, message.order);
        return;
    }
  }

  function rejoin(session: Session, token: string, from: number): void {
    const found = games.findSeat(token);
    const error = found ? found.room.rejoin(found.seat, session.peer, from) : "token_invalid";
    if (error || !found) {
      reply(session, error ?? "token_invalid");
      return;
    }
    session.room = found.room;
    session.seat = found.seat;
    session.idleSince = undefined;
    metrics.rejoins.inc();
    logger.info("player_rejoined", { game: found.room.id, player: found.seat.id, from });
  }

  const sessions = new Set<Session>();

  sockets.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const session: Session = {
      socket,
      address: clientAddress(request),
      client: pseudonym(clientAddress(request)),
      messages: new TokenBucket(messageRate.perSecond, messageRate.burst, Date.now()),
      name: undefined,
      room: undefined,
      seat: undefined,
      idleSince: undefined,
      closing: false,
      peer: {
        send(frame) {
          if (socket.readyState === socket.OPEN) socket.send(frame);
        },
        probe() {
          const sentAt = Date.now();
          ping(socket, sentAt);
          setTimeout(() => {
            const since = unanswered.get(socket);
            if (since !== undefined && since <= sentAt) socket.terminate();
          }, probeTimeoutMs).unref();
        },
      },
    };
    sessions.add(session);

    const helloTimer = setTimeout(() => {
      if (session.name === undefined) reject(session, CloseCode.idle, "no hello", "idle");
    }, helloTimeoutMs);

    socket.on("pong", () => unanswered.delete(socket));
    // Protocol errors, such as an oversized frame: ws closes the socket itself.
    socket.on("error", (error: Error & { code?: string }) => {
      const label = error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH" ? "oversized" : "invalid";
      metrics.rejected.inc({ reason: label });
      logger.warn("connection_rejected", { client: session.client, reason: label });
    });

    socket.on("message", (data, isBinary) => {
      if (session.closing) return;
      metrics.messages.inc();
      if (!session.messages.take(Date.now())) {
        reject(session, CloseCode.rateLimited, "too many messages", "rate_limited");
        return;
      }
      const parsed = parseClientMessage(toFrame(data, isBinary));
      if (!parsed.ok) {
        reject(session, CloseCode.invalidMessage, parsed.error, "invalid");
        return;
      }
      handle(session, parsed.value);
    });

    socket.on("close", () => {
      clearTimeout(helloTimer);
      sessions.delete(session);
      const current = seatOf(session);
      if (current) current.room.disconnect(current.seat, Date.now());
      games.sweep();
    });
  });

  const ticker = setInterval(() => {
    const started = performance.now();
    games.update(Date.now());
    lastTurnAt = performance.now();
    metrics.turnDuration.observe((lastTurnAt - started) / 1000);
  }, 1000 / TICK_RATE);

  function snapshot(): Snapshot {
    const counts = { open: 0, starting: 0, running: 0 };
    let players = 0;
    for (const room of games.all()) {
      if (room.state !== "finished") counts[room.state]++;
      players += room.connectedCount;
    }
    return { games: counts, players, connections: sockets.clients.size };
  }

  /** Closes connections that have stayed out of any game for too long. */
  function closeIdle(now: number): void {
    for (const session of sessions) {
      if (session.name === undefined) continue;
      if (seatOf(session)) {
        session.idleSince = undefined;
        continue;
      }
      session.idleSince ??= now;
      if (now - session.idleSince >= idleTimeoutMs) {
        reject(session, CloseCode.idle, "idle for too long", "idle");
      }
    }
  }

  // A socket that left a ping unanswered for a whole interval is gone, even if
  // TCP has not noticed yet. Timer drift is allowed for with half an interval.
  const heartbeat = setInterval(() => {
    const now = Date.now();
    closeIdle(now);
    for (const socket of sockets.clients) {
      const since = unanswered.get(socket);
      if (since !== undefined && now - since >= pingIntervalMs / 2) socket.terminate();
      else ping(socket, now);
    }
  }, pingIntervalMs);

  return {
    http,
    games,
    metrics,
    close() {
      stopping = true;
      clearInterval(heartbeat);
      clearInterval(ticker);
      games.stopAll();
      for (const socket of sockets.clients) socket.close(1012, "server restarting");
      return new Promise((resolve) => {
        http.close(() => {
          resolve();
        });
      });
    },
  };
}

/** If-None-Match lists tags, which proxies may have weakened; any match will do. */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//, "");
  return header.split(",").some((tag) => bare(tag) === bare(etag) || tag.trim() === "*");
}

/** Builds match, or one side is a development build. */
function sameBuild(client: string, server: string): boolean {
  return client === server || client === "dev" || server === "dev";
}

function acceptsGzip(request: IncomingMessage): boolean {
  const header = request.headers["accept-encoding"];
  return typeof header === "string" && /(^|[\s,])gzip(?!;\s*q=0(\.0*)?(\s*,|$))/i.test(header);
}

function sendJson(response: ServerResponse, body: unknown): void {
  response
    .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
    .end(JSON.stringify(body));
}
