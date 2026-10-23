import { randomInt } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { parseClientMessage, TICK_RATE, type ServerMessage } from "@frontfall/protocol";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { Lobby } from "./lobby.ts";
import { isAllowedOrigin } from "./origin.ts";
import { loadStaticFile } from "./static-files.ts";

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
}

export interface GameServer {
  readonly http: Server;
  /** Tells every player the server is restarting, then stops accepting requests. */
  close(): Promise<void>;
}

/** Cloudflare drops a WebSocket that stays silent for 100 s. */
const DEFAULT_PING_INTERVAL_MS = 25_000;

interface Room {
  name: string;
  lobby: Lobby;
  sockets: Set<WebSocket>;
  timer: NodeJS.Timeout;
}

/**
 * Address of the player. The reverse proxy in front of the server sets
 * X-Client-IP and overwrites any value the browser sent.
 */
export function clientAddress(request: IncomingMessage): string {
  const header = request.headers["x-client-ip"];
  const forwarded = (Array.isArray(header) ? header[0] : header)?.trim();
  return forwarded || (request.socket.remoteAddress ?? "unknown");
}

function decode(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString("utf8");
}

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

export function createGameServer(options: ServerOptions): GameServer {
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const maxConnectionsPerAddress = options.maxConnectionsPerAddress ?? 8;
  const maxRooms = options.maxRooms ?? 500;

  const rooms = new Map<string, Room>();
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

  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });

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

  function openRoom(name: string): Room {
    const room: Room = {
      name,
      lobby: new Lobby(randomInt(2 ** 31)),
      sockets: new Set(),
      timer: setInterval(() => {
        const message = JSON.stringify({ type: "turn", turn: room.lobby.closeTurn() });
        for (const socket of room.sockets) socket.send(message);
      }, 1000 / TICK_RATE),
    };
    rooms.set(name, room);
    return room;
  }

  sockets.on("connection", (socket: WebSocket) => {
    let room: Room | undefined;
    let player: string | undefined;
    alive.add(socket);

    socket.on("pong", () => alive.add(socket));

    socket.on("message", (data) => {
      const parsed = parseClientMessage(decode(data));
      if (!parsed.ok) {
        send(socket, { type: "error", message: parsed.error });
        return;
      }
      const message = parsed.value;
      if (message.type === "join") {
        if (room) return;
        const existing = rooms.get(message.lobby);
        if (!existing && rooms.size >= maxRooms) {
          send(socket, { type: "error", message: "too many games in progress" });
          return;
        }
        room = existing ?? openRoom(message.lobby);
        player = room.lobby.join();
        room.sockets.add(socket);
        send(socket, { type: "joined", player, seed: room.lobby.seed });
      } else if (room && player) {
        room.lobby.submit(player, message.intent);
      }
    });

    socket.on("close", () => {
      if (!room || !player) return;
      room.lobby.leave(player);
      room.sockets.delete(socket);
      if (room.lobby.playerCount === 0) {
        clearInterval(room.timer);
        rooms.delete(room.name);
      }
    });
  });

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
    close() {
      clearInterval(heartbeat);
      for (const room of rooms.values()) clearInterval(room.timer);
      for (const socket of sockets.clients) {
        send(socket, { type: "error", message: "server restarting" });
        socket.close(1012, "server restarting");
      }
      return new Promise((resolve) => {
        http.close(() => {
          resolve();
        });
      });
    },
  };
}
