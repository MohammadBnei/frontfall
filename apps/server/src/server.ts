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
import { isAllowedOrigin } from "./origin.ts";
import type { Peer, Room, RoomSettings, Seat } from "./room.ts";
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
  publicGame?: Partial<GameSettings>;
  privateGame?: Partial<GameSettings>;
}

export interface GameServer {
  readonly http: Server;
  readonly games: Directory;
  /** Tells every player the server is restarting, then stops accepting requests. */
  close(): Promise<void>;
}

/** Cloudflare drops a WebSocket that stays silent for 100 s. */
const DEFAULT_PING_INTERVAL_MS = 25_000;

/** Largest frame a client may send. Orders take a few bytes, hello a few dozen. */
const MAX_PAYLOAD_BYTES = 1024;

export const DEFAULT_GAME: GameSettings = {
  map: "default",
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

/** What one WebSocket connection has done so far. */
interface Session {
  readonly socket: WebSocket;
  readonly peer: Peer;
  name: string | undefined;
  room: Room | undefined;
  seat: Seat | undefined;
}

export function createGameServer(options: ServerOptions): GameServer {
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const maxConnectionsPerAddress = options.maxConnectionsPerAddress ?? 8;
  const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
  const probeTimeoutMs = options.probeTimeoutMs ?? 5_000;

  const games = new Directory({
    maxRooms: options.maxRooms ?? 500,
    publicGame: { ...DEFAULT_GAME, ...options.publicGame },
    privateGame: { ...DEFAULT_GAME, ...options.privateGame },
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
    void loadStaticFile(options.staticRoot, path).then((file) => {
      if (!file) {
        response.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      response.writeHead(200, {
        "content-type": file.contentType,
        "x-content-type-options": "nosniff",
        // Built assets carry a content hash in their name; the page itself must stay fresh.
        "cache-control": path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      if (request.method === "HEAD") response.end();
      else response.end(file.body);
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

  function reply(session: Session, code: ErrorCode, message: string): void {
    session.peer.send(encodeServerMessage({ type: "error", code, message }));
  }

  /** The seat of this connection, if it still holds one in a game. */
  function seatOf(session: Session): { room: Room; seat: Seat } | undefined {
    const { room, seat } = session;
    if (!room || !seat || !room.holds(seat) || seat.peer !== session.peer) return undefined;
    return { room, seat };
  }

  function enter(session: Session, room: Room | undefined, missing: ErrorCode): void {
    if (!room) {
      reply(
        session,
        missing,
        missing === "not_found" ? "no such game" : "too many games in progress",
      );
      return;
    }
    const seat = room.join(session.name ?? "", session.peer, Date.now());
    if (typeof seat === "string") {
      reply(
        session,
        seat,
        seat === "game_full" ? "the game is full" : "the game has already started",
      );
      games.sweep();
      return;
    }
    session.room = room;
    session.seat = seat;
  }

  function handle(session: Session, message: ClientMessage): void {
    if (message.type === "hello") {
      if (session.name !== undefined) {
        session.socket.close(CloseCode.invalidMessage, "hello was already sent");
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
      session.peer.send(encodeServerMessage({ type: "welcome", version: PROTOCOL_VERSION }));
      return;
    }
    if (session.name === undefined) {
      session.socket.close(CloseCode.invalidMessage, "hello must come first");
      return;
    }

    const current = seatOf(session);
    switch (message.type) {
      case "play":
      case "create":
      case "join":
      case "rejoin":
        if (current) {
          reply(session, "already_in_game", "leave the current game first");
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
        if (error) reply(session, error, "only the host of a private game can start it");
        return;
      }
      case "leave":
        if (!current) return;
        current.room.leave(current.seat, Date.now());
        session.room = undefined;
        session.seat = undefined;
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
    if (!found) {
      reply(session, "token_invalid", "this game is over or the seat was given up");
      return;
    }
    const error = found.room.rejoin(found.seat, session.peer, from);
    if (error) {
      reply(
        session,
        error,
        error === "token_in_use" ? "the seat is still connected" : "cannot rejoin",
      );
      return;
    }
    session.room = found.room;
    session.seat = found.seat;
  }

  sockets.on("connection", (socket: WebSocket) => {
    const session: Session = {
      socket,
      name: undefined,
      room: undefined,
      seat: undefined,
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

    const helloTimer = setTimeout(() => {
      if (session.name === undefined) socket.close(CloseCode.idle, "no hello");
    }, helloTimeoutMs);

    socket.on("pong", () => alive.add(socket));
    // Protocol errors such as an oversized frame: ws closes the socket itself.
    socket.on("error", () => undefined);

    socket.on("message", (data, isBinary) => {
      const parsed = parseClientMessage(toFrame(data, isBinary));
      if (!parsed.ok) {
        socket.close(CloseCode.invalidMessage, parsed.error.slice(0, 120));
        return;
      }
      handle(session, parsed.value);
    });

    socket.on("close", () => {
      clearTimeout(helloTimer);
      const current = seatOf(session);
      if (current) current.room.disconnect(current.seat, Date.now());
      games.sweep();
    });
  });

  const ticker = setInterval(() => {
    games.update(Date.now());
  }, 1000 / TICK_RATE);

  // A socket that missed the previous ping is gone, even if TCP has not noticed yet.
  const heartbeat = setInterval(() => {
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

function sendJson(response: ServerResponse, body: unknown): void {
  response
    .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
    .end(JSON.stringify(body));
}
