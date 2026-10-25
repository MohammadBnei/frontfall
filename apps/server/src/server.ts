import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CloseCode,
  encodeServerMessage,
  normalizeGameName,
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
import { clientAddress, isLocalRequest, isLoopbackRequest } from "./address.ts";
import { isAllowedOrigin } from "./origin.ts";
import { TokenBucket } from "./rate-limit.ts";
import type { Peer, Room, RoomObserver, RoomSettings, Seat } from "./room.ts";
import { SECURITY_HEADERS, sendCachedJson, sendJson, serveStatic } from "./http-replies.ts";
import { gamesDirectory, loadGames, saveGame } from "./saved-games.ts";
import { statusPage, type ServerStatus } from "./status-page.ts";
import { usageInbox } from "./usage-http.ts";
import { loadUsage, saveUsage, usageFile, UsageStats, usageTable } from "./usage.ts";

export { statusPage, type ServerStatus } from "./status-page.ts";

type GameSettings = Omit<RoomSettings, "visibility" | "name">;

export interface ServerOptions {
  /** Directory of the built client. */
  staticRoot: string;
  /** Only WebSockets opened by pages of this origin are accepted. Unset accepts any. */
  allowedOrigin?: string | undefined;
  /** Build identifier, returned by /healthz so a deployment can be checked. */
  version: string;
  /** Release of the game, such as 0.4.0, returned by /healthz next to the build. */
  release?: string;
  /**
   * Simulation build (docs/protocol.md): pages that send another one in
   * `hello` are asked to reload. Unset compares with the build instead.
   */
  simulation?: string;
  pingIntervalMs?: number;
  maxConnectionsPerAddress?: number;
  /** Open WebSockets the whole server accepts. */
  maxConnections?: number;
  /** Games not yet started, public or private, that one address may hold. */
  maxLobbiesPerAddress?: number;
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
  /** On close, how long running games may go on before they are stopped. */
  drainMs?: number;
  /** More of /status, as HTML that is already escaped, such as usage figures. */
  statusSections?: () => string;
  /** Messages a connection may send per second on average, and at once. */
  messageRate?: { perSecond: number; burst: number };
  /** Public games opened by "play", which start on their own after a countdown. */
  publicGame?: Partial<GameSettings>;
  /** Games a host creates, public or private, and starts themselves. */
  privateGame?: Partial<GameSettings>;
  logger?: Logger;
  /**
   * Directory the server keeps data in between restarts: the usage counts in
   * `usage/`, and in `games/` the games running when it stopped, which the
   * next run of the same simulation build takes back. Unset keeps the counts
   * in memory only, and running games end with the server.
   */
  dataDir?: string | undefined;
  /** How often the usage counts are written to the data directory. */
  usageSaveIntervalMs?: number;
}

export interface GameServer {
  readonly http: Server;
  readonly games: Directory;
  readonly metrics: Metrics;
  /** Counts of what players do, from the reports of their pages; /api/stats exports them. */
  readonly usage: UsageStats;
  /**
   * Stops opening games and lets the running ones go on, for `drainMs` at
   * most, then tells every player the server is restarting and stops.
   */
  close(): Promise<void>;
}

/** Cloudflare drops a WebSocket that stays silent for 100 s. */
const DEFAULT_PING_INTERVAL_MS = 25_000;

/** How often a draining server looks for games still running. */
const DRAIN_CHECK_MS = 250;

/** Largest frame a client may send. Orders take a few bytes, hello a few dozen. */
const MAX_PAYLOAD_BYTES = 1024;

export const DEFAULT_GAME: GameSettings = {
  map: "world",
  capacity: 16,
  autoStart: true,
  bots: 0,
  difficulty: "normal",
  nations: true,
  teams: 0,
  disabled: 0,
  minPlayers: 2,
  countdownMs: 60_000,
  hostIdleMs: 2 * 60_000,
  soloBots: 0,
  reconnectGraceMs: 5 * 60_000,
  lobbyGraceMs: 30_000,
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
  invalid_settings: "no such map, or too many bots or seats for it",
  restarting: "the server is about to restart; try again in a few minutes",
  invalid_game_name: "the game name is not allowed",
  not_enough_players: "wait for more players before starting",
  too_many_lobbies: "you already have three games waiting to start",
};

/**
 * Seats a game keeps with these options: those the host asked for, fewer on a
 * small map or with many bots, never fewer than the players already in. Bots
 * beyond the server's cap or that leave no seat for them give undefined.
 */
function seatsFor(
  options: GameOptions,
  maps: MapLimits,
  maxBots: number,
  players: number,
): number | undefined {
  const maxPlayers = maps.get(options.map)?.max;
  if (maxPlayers === undefined || options.bots > maxBots) return undefined;
  const seats = Math.min(options.capacity, maxPlayers - options.bots);
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
  // Players behind one home router or a mobile carrier share an address.
  const maxConnectionsPerAddress = options.maxConnectionsPerAddress ?? 16;
  const maxConnections = options.maxConnections ?? 5_000;
  const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
  const probeTimeoutMs = options.probeTimeoutMs ?? 5_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
  const messageRate = options.messageRate ?? { perSecond: 20, burst: 40 };
  const stallAfterMs = options.stallAfterMs ?? 5000;
  const drainMs = options.drainMs ?? 20_000;
  /** End of the last pass of the turn timer, and whether close() has begun. */
  let lastTurnAt = performance.now();
  let stopping = false;
  let closing: Promise<void> | undefined;
  /** When an announced restart is due, as `Date.now()` time. */
  let maintenanceAt: number | undefined;
  const logger = options.logger ?? silentLogger;
  const pseudonym = addressPseudonym();
  const metrics = new Metrics();

  const observer: RoomObserver = {
    started(room) {
      metrics.gamesStarted.inc({
        visibility: room.settings.visibility,
        map: room.settings.map,
        teams: String(room.settings.teams),
      });
      logger.info("game_started", {
        game: room.id,
        visibility: room.settings.visibility,
        players: room.playerCount,
      });
    },
    finished(room, reason) {
      metrics.gamesFinished.inc({ reason });
      if (room.log.length > 0) metrics.gameMinutes.observe(room.log.length / TICK_RATE / 60);
      logger.info("game_finished", { game: room.id, reason, ticks: room.log.length });
    },
    desync(room, tick, hash, expected) {
      metrics.desyncs.inc();
      logger.warn("desync", { game: room.id, tick, hash, expected: expected ?? null });
    },
  };
  const privateGame = { ...DEFAULT_GAME, minPlayers: 1, countdownMs: 0, ...options.privateGame };
  const maps = loadMapLimits(options.staticRoot, privateGame.map);
  const publicMap = options.publicGame?.map ?? DEFAULT_GAME.map;
  const publicGame = {
    ...DEFAULT_GAME,
    soloBots: maps.get(publicMap)?.bots ?? 0,
    ...options.publicGame,
  };
  const maxBots = options.maxBots ?? 25;
  const games = new Directory({
    maxRooms: options.maxRooms ?? 500,
    maxLobbiesPerOwner: options.maxLobbiesPerAddress ?? 3,
    publicGame,
    privateGame,
    observer,
  });
  const simulation = options.simulation ?? options.version;
  const savedGames = options.dataDir === undefined ? undefined : gamesDirectory(options.dataDir);
  if (savedGames !== undefined) {
    const { games: saved, refused } = loadGames(savedGames, simulation);
    const now = Date.now();
    for (const game of saved) {
      if (games.restore(game, now))
        logger.info("game_restored", { game: game.id, ticks: game.log.ends.length });
      else refused.push({ file: game.id, reason: "unreadable" });
    }
    for (const { file, reason } of refused) logger.warn("game_not_restored", { file, reason });
  }
  /**
   * Saves the running games for the next run, which takes them back if it has
   * the same simulation build. Their players are not told the game ended:
   * their pages reconnect until the server is back.
   */
  const keepGames = (): void => {
    if (savedGames === undefined) return;
    const now = Date.now();
    for (const room of games.all()) {
      const saved = room.playerCount > 0 ? room.save(now) : undefined;
      if (!saved) continue;
      try {
        saveGame(savedGames, simulation, saved);
        room.suspend();
        logger.info("game_saved", { game: room.id, ticks: room.log.length });
      } catch (error) {
        logger.warn("game_not_saved", { game: room.id, error: (error as Error).message });
      }
    }
  };
  const usage = new UsageStats({ release: options.release ?? "dev", maps: new Set(maps.keys()) });
  const usageAt = options.dataDir === undefined ? undefined : usageFile(options.dataDir);
  if (usageAt === undefined) {
    logger.warn("usage_in_memory", { reason: "no data directory" });
  } else {
    const error = loadUsage(usage, usageAt);
    if (error) logger.warn("usage_not_loaded", { error: error.message });
  }
  /** Writes the usage counts, if there is somewhere to keep them; never stops the server. */
  const keepUsage = (): void => {
    if (usageAt === undefined) return;
    try {
      saveUsage(usage, usageAt, Date.now());
    } catch (error) {
      logger.warn("usage_not_saved", { error: (error as Error).message });
    }
  };
  const usageSaver = setInterval(keepUsage, options.usageSaveIntervalMs ?? 5 * 60_000);
  usageSaver.unref();
  const reports = usageInbox(usage, logger, (origin) =>
    isAllowedOrigin(origin, options.allowedOrigin),
  );
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
          ...(options.release ? { "x-frontfall-release": options.release } : {}),
        })
        .end(status);
      return;
    }
    if (path === "/admin/maintenance" && isLoopbackRequest(request)) {
      announce(request, response);
      return;
    }
    if (path === "/api/usage") {
      reports.handle(request, response, clientAddress(request));
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    if (path === "/api/games") {
      sendCachedJson(request, response, { games: games.publicGames(), running: running() });
      return;
    }
    if (path === "/api/status") {
      sendJson(response, status());
      return;
    }
    if (path === "/status") {
      response
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          ...SECURITY_HEADERS,
        })
        .end(
          request.method === "HEAD"
            ? undefined
            : statusPage(
                status(),
                usageTable(usage.export(Date.now())) + (options.statusSections?.() ?? ""),
              ),
        );
      return;
    }
    if (path === "/api/stats") {
      // Totals by the day: a minute late is fine, and spares the server repeated scrapes.
      sendJson(response, usage.export(Date.now()), "public, max-age=60");
      return;
    }
    if (path === "/metrics" && isLocalRequest(request)) {
      response
        .writeHead(200, {
          "content-type": "text/plain; version=0.0.4",
          "cache-control": "no-store",
        })
        .end(metrics.render(snapshot(), usage.renderMetrics()));
      return;
    }
    serveStatic(options.staticRoot, path, request, response);
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
      if (message.build && !sameBuild(message.build, simulation)) {
        session.socket.close(CloseCode.versionMismatch, `build ${simulation} required`);
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
      const now = Date.now();
      if (maintenanceAt !== undefined && maintenanceAt > now) {
        session.peer.send(maintenanceMessage(maintenanceAt - now));
      }
      return;
    }
    if (session.name === undefined) {
      reject(session, CloseCode.invalidMessage, "hello must come first", "invalid");
      return;
    }

    const current = seatOf(session);
    if (current) current.room.touch(current.seat, Date.now());
    switch (message.type) {
      case "play":
      case "create":
      case "join":
      case "rejoin":
        if (current) {
          reply(session, "already_in_game");
          return;
        }
        // Players of a running game may still come back while the server drains.
        if (stopping && message.type !== "rejoin") {
          reply(session, "restarting");
          return;
        }
        if (message.type === "play") {
          const name = gameName(message.name, session.name);
          enter(session, games.quickMatch(session.address, name), "too_many_games");
        } else if (message.type === "create") {
          const visibility = message.visibility ?? "private";
          let name: string | null = null;
          if (visibility === "public") {
            // Without a name of their own, the player gets one that is always valid, as with play.
            if (message.name === undefined) name = gameName(undefined, session.name);
            else {
              const checked = normalizeGameName(message.name);
              if (!checked.ok) {
                reply(session, "invalid_game_name", checked.error);
                return;
              }
              name = checked.name;
            }
          }
          if (games.atLobbyLimit(session.address)) {
            reply(session, "too_many_lobbies");
            return;
          }
          const room = games.create({ kind: "hosted", visibility, name }, session.address);
          enter(session, room, "too_many_games");
        } else if (message.type === "join") enter(session, games.find(message.game), "not_found");
        else rejoin(session, message.token, message.from);
        return;
      case "configure": {
        if (!current) {
          reply(session, "not_in_game");
          return;
        }
        // A host's form runs ahead of the answers: a refusal sends the settings that hold.
        const refuse = (code: ErrorCode, text?: string): void => {
          reply(session, code, text);
          if (message.seq !== undefined) {
            current.room.refusedConfigure(current.seat, message.seq, Date.now());
          }
        };
        const seats = seatsFor(message.options, maps, maxBots, current.room.playerCount);
        if (seats === undefined) {
          refuse("invalid_settings");
          return;
        }
        let name: string | undefined;
        if (message.name !== undefined && current.room.settings.visibility === "public") {
          const checked = normalizeGameName(message.name);
          if (!checked.ok) {
            refuse("invalid_game_name", checked.error);
            return;
          }
          name = games.uniqueName(checked.name, current.room);
        }
        // A quick game keeps filling in with the new map's bots.
        const soloBots =
          current.room.settings.soloBots > 0 ? (maps.get(message.options.map)?.bots ?? 0) : 0;
        const error = current.room.configure(
          current.seat,
          { ...message.options, capacity: seats, soloBots, ...(name !== undefined && { name }) },
          Date.now(),
          message.seq,
        );
        if (error) refuse(error);
        return;
      }
      case "start": {
        const error = current ? current.room.requestStart(current.seat, Date.now()) : "not_in_game";
        if (error) reply(session, error);
        return;
      }
      case "hold": {
        const error = current ? current.room.hold(current.seat, Date.now()) : "not_in_game";
        if (error) reply(session, error);
        return;
      }
      case "active":
        return;
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
    const error = found
      ? found.room.rejoin(found.seat, session.peer, from, Date.now())
      : "token_invalid";
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

    socket.on("close", (code) => {
      clearTimeout(helloTimer);
      sessions.delete(session);
      const current = seatOf(session);
      // 1000 and 1001 come from a page that closed the socket itself; a lost
      // network or a phone gone to sleep closes it without a code (1006).
      if (current)
        current.room.disconnect(current.seat, Date.now(), code === 1000 || code === 1001);
      games.sweep();
    });
  });

  const ticker = setInterval(() => {
    const started = performance.now();
    games.update(Date.now());
    lastTurnAt = performance.now();
    metrics.turnDuration.observe((lastTurnAt - started) / 1000);
  }, 1000 / TICK_RATE);

  /**
   * Games a restart would cut short: started, with a player connected or
   * still holding a seat to come back to. A deployment waits for none to be
   * left; lobbies are told and closed.
   */
  function running(): number {
    let count = 0;
    for (const room of games.all()) {
      if (room.state === "running" && room.playerCount > 0) count++;
    }
    return count;
  }

  function maintenanceMessage(inMs: number | null): Frame {
    return encodeServerMessage({
      type: "maintenance",
      inMs: inMs === null ? null : Math.max(0, Math.round(inMs)),
    });
  }

  /** Tells every connection that has said hello. */
  function broadcastAll(frame: Frame): void {
    for (const session of sessions) if (session.name !== undefined) session.peer.send(frame);
  }

  /**
   * POST /admin/maintenance?minutes=N, from inside the container: tells every
   * player the server restarts in N minutes; 0 calls it off. The answer gives
   * the games running, which the restart would stop.
   */
  function announce(request: IncomingMessage, response: ServerResponse): void {
    const minutes = Number(
      new URL(request.url ?? "/", "http://localhost").searchParams.get("minutes"),
    );
    if (request.method !== "POST" || !Number.isFinite(minutes) || minutes < 0 || minutes > 120) {
      response.writeHead(400, { "content-type": "text/plain" }).end("POST ?minutes=0 to 120");
      return;
    }
    maintenanceAt = minutes > 0 ? Date.now() + minutes * 60_000 : undefined;
    broadcastAll(maintenanceMessage(minutes > 0 ? minutes * 60_000 : null));
    logger.info("maintenance_announced", { minutes });
    sendJson(response, { minutes, running: running() });
  }

  function status(): ServerStatus {
    const now = Date.now();
    let lobbies = 0;
    let players = 0;
    for (const room of games.all()) {
      if (room.state === "open" || room.state === "starting") lobbies++;
      players += room.connectedCount;
    }
    return {
      version: options.version,
      release: options.release ?? "dev",
      simulation: options.simulation ?? "dev",
      keepsGames: savedGames !== undefined,
      state: stopping ? "stopping" : "ok",
      players,
      running: running(),
      lobbies,
      restartInMs: maintenanceAt !== undefined && maintenanceAt > now ? maintenanceAt - now : null,
    };
  }

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
    usage,
    close() {
      if (closing) return closing;
      stopping = true;
      // Lobbies would never start: they end now. Running games play on.
      for (const room of games.all()) if (room.state !== "running") room.stop("restart");
      games.sweep();
      // Games that are kept need no drain: they stop at once and go on after the restart.
      const drainFor = savedGames === undefined ? drainMs : 0;
      const deadline = performance.now() + drainFor;
      if (drainFor > 0 && running() > 0) broadcastAll(maintenanceMessage(drainFor));
      closing = new Promise<void>((resolve) => {
        const finish = (): void => {
          clearInterval(usageSaver);
          keepUsage();
          clearInterval(heartbeat);
          clearInterval(ticker);
          keepGames();
          games.stopAll("restart");
          for (const socket of sockets.clients) socket.close(1012, "server restarting");
          http.close(() => {
            resolve();
          });
        };
        const check = (): void => {
          if (running() > 0 && performance.now() < deadline) setTimeout(check, DRAIN_CHECK_MS);
          else finish();
        };
        check();
      });
      return closing;
    },
  };
}

/** Builds match, or one side is a development build. */
function sameBuild(client: string, server: string): boolean {
  return client === server || client === "dev" || server === "dev";
}

/** What a public game opened without a name is listed as. */
function defaultGameName(player: string | undefined): string {
  return player ? `${player}'s game` : "Frontfall game";
}

/** The name asked for a game "play" may open, or a default when it is missing or refused. */
function gameName(asked: string | undefined, player: string | undefined): string {
  for (const candidate of [asked, defaultGameName(player)]) {
    if (candidate === undefined) continue;
    const checked = normalizeGameName(candidate);
    if (checked.ok) return checked.name;
  }
  return defaultGameName(undefined);
}
