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
} from "@frontfall/protocol";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { Directory } from "./directory.ts";
import { addressPseudonym, silentLogger, type Logger } from "./log.ts";
import { Metrics, type Snapshot } from "./metrics.ts";
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
  maxRooms?: number;
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
  minPlayers: 2,
  countdownMs: 30_000,
  reconnectGraceMs: 120_000,
  maxDurationMs: 4 * 60 * 60 * 1000,
};

/**
 * Address of the player. The reverse proxy in front of the server sets
 * X-Client-IP and overwrites any value the browser sent.
 */
export function clientAddress(request: IncomingMessage): string {
  const header = request.headers["x-client-ip"];
  const forwarded = (Array.isArray(header) ? header[0] : header)?.trim();
  return forwarded || (request.socket.remoteAddress ?? "unknown");
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
  not_host: "only the host can start the game",
  too_many_games: "too many games in progress",
  token_invalid: "this game is over or the seat was given up",
  token_in_use: "the seat is still connected",
};

/** What one WebSocket connection has done so far. */
interface Session {
  readonly socket: WebSocket;
  readonly peer: Peer;
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

/**
 * Proxies add these headers. /metrics answers only requests that reach the
 * server directly, from the host, so it is never public.
 */
const PROXY_HEADERS = [
  "x-client-ip",
  "x-forwarded-for",
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
];

export function createGameServer(options: ServerOptions): GameServer {
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const maxConnectionsPerAddress = options.maxConnectionsPerAddress ?? 8;
  const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
  const probeTimeoutMs = options.probeTimeoutMs ?? 5_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
  const messageRate = options.messageRate ?? { perSecond: 20, burst: 40 };
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
    desync(room, tick) {
      metrics.desyncs.inc();
      logger.warn("desync", { game: room.id, tick });
    },
  };
  const games = new Directory({
    maxRooms: options.maxRooms ?? 500,
    publicGame: { ...DEFAULT_GAME, ...options.publicGame },
    privateGame: { ...DEFAULT_GAME, ...options.privateGame },
    observer,
  });
  const alive = new WeakSet<WebSocket>();
  const connectionsByAddress = new Map<string, number>();

  const http = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/healthz") {
      response
        .writeHead(200, {
          "content-type": "text/plain",
          "cache-control": "no-store",
          "x-frontfall-version": options.version,
        })
        .end("ok");
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
    if (path === "/metrics" && !PROXY_HEADERS.some((name) => name in request.headers)) {
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
      response.writeHead(200, {
        "content-type": file.contentType,
        "x-content-type-options": "nosniff",
        // Built assets carry a content hash in their name; the page itself must stay fresh.
        "cache-control": path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
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
    session.socket.close(code, reason.slice(0, 120));
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
          enter(session, games.create("private"), "too_many_games");
        else if (message.type === "join") enter(session, games.find(message.game), "not_found");
        else rejoin(session, message.token, message.from);
        return;
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
          alive.delete(socket);
          socket.ping();
          setTimeout(() => {
            if (!alive.has(socket)) socket.terminate();
          }, probeTimeoutMs).unref();
        },
      },
    };
    alive.add(socket);
    sessions.add(session);

    const helloTimer = setTimeout(() => {
      if (session.name === undefined) reject(session, CloseCode.idle, "no hello", "idle");
    }, helloTimeoutMs);

    socket.on("pong", () => alive.add(socket));
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
    metrics.turnDuration.observe((performance.now() - started) / 1000);
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

  // A socket that missed the previous ping is gone, even if TCP has not noticed yet.
  const heartbeat = setInterval(() => {
    closeIdle(Date.now());
    for (const socket of sockets.clients) {
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, pingIntervalMs);

  return {
    http,
    games,
    metrics,
    close() {
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
