import {
  CloseCode,
  encodeClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorCode,
  type Order,
  type ServerMessage,
  type Turn,
} from "@frontfall/protocol";

const MAX_RETRY_DELAY_MS = 10_000;

/** WebSocket URL next to the page, so the game works under any path prefix. */
export function socketUrl(page: string): string {
  const url = new URL("ws", page);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.hash = "";
  url.search = "";
  return url.href;
}

export function retryDelay(attempt: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** attempt);
}

export type LobbyState = Extract<ServerMessage, { type: "lobby" }>;
export type GameStart = Extract<ServerMessage, { type: "started" }>;

export type ConnectionStatus =
  /** Opening the socket or saying hello. */
  | "connecting"
  /** Ready to play or playing. */
  | "online"
  /** The connection dropped; a new attempt starts after `retryInMs`. */
  | "offline"
  /** The server speaks another protocol version: the page must be reloaded. */
  | "outdated";

export interface OnlineEvents {
  status?(status: ConnectionStatus, retryInMs?: number): void;
  lobby?(lobby: LobbyState): void;
  /** The game starts, or starts again after a rejoin: reset the simulation, then expect turns. */
  started?(game: GameStart): void;
  /** Consecutive turns, never skipping one, from the tick after the last one delivered. */
  turns?(turns: Turn[]): void;
  desync?(tick: number): void;
  ended?(reason: Extract<ServerMessage, { type: "ended" }>["reason"]): void;
  error?(code: ErrorCode, message: string): void;
}

/** The subset of the browser WebSocket this module needs, so tests can supply their own. */
export interface SocketLike {
  binaryType: BinaryType;
  readonly readyState: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code: number }) => void): void;
}

export interface OnlineOptions {
  url: string;
  name: string;
  /** Build of the page, so the server can turn away an outdated one. */
  build?: string;
  events: OnlineEvents;
  createSocket?: (url: string) => SocketLike;
  setTimer?: (callback: () => void, ms: number) => unknown;
}

/** How a player enters an online game: the next public one, a new private one, or one by id. */
export type OnlineEntry = { type: "play" } | { type: "join"; game: string } | { type: "create" };
type Entry = OnlineEntry;

/**
 * One player's link to the game server. It keeps the connection open,
 * reconnecting with backoff, and takes back the player's seat after a drop:
 * the server then resends every turn the client missed.
 */
export class OnlineClient {
  private socket: SocketLike | undefined;
  private attempt = 0;
  private closedByUser = false;
  /** What the player asked for, replayed if the connection drops before the game starts. */
  private entry: Entry | undefined;
  private game: GameStart | undefined;
  private nextTick = 0;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;

  constructor(private readonly options: OnlineOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.open();
  }

  /** Join the public game that starts soonest. */
  play(): void {
    this.enter({ type: "play" });
  }

  /** Open a private game; share its id as `?game=<id>`. */
  create(): void {
    this.enter({ type: "create" });
  }

  join(game: string): void {
    this.enter({ type: "join", game });
  }

  /** Host of a private game: start now. */
  start(): void {
    this.send({ type: "start" });
  }

  leave(): void {
    this.entry = undefined;
    this.game = undefined;
    this.send({ type: "leave" });
  }

  order(order: Order): void {
    this.send({ type: "order", order });
  }

  /** Hash of the local game state after running `tick`, for desync detection. */
  hash(tick: number, hash: number): void {
    this.send({ type: "hash", tick, hash });
  }

  close(): void {
    this.closedByUser = true;
    this.socket?.close(1000);
  }

  private enter(entry: Entry): void {
    this.entry = entry;
    this.game = undefined;
    this.send(entry);
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === 1) this.socket.send(encodeClientMessage(message));
  }

  private open(): void {
    this.options.events.status?.("connecting");
    const socket = this.createSocket(this.options.url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", () => {
      socket.send(
        encodeClientMessage({
          type: "hello",
          version: PROTOCOL_VERSION,
          name: this.options.name,
          ...(this.options.build !== undefined && { build: this.options.build }),
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
      if (typeof data !== "string" && !(data instanceof Uint8Array)) return;
      const parsed = parseServerMessage(data);
      if (parsed.ok) this.receive(parsed.value);
      // Turns this page cannot read come from a newer server: going on would skip
      // them and desynchronise, so stop and ask for a reload.
      else if (data instanceof Uint8Array) this.outdated(socket);
    });
    socket.addEventListener("close", ({ code }) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      if (code === CloseCode.versionMismatch) {
        this.outdated(socket);
        return;
      }
      if (this.closedByUser) return;
      const delay = retryDelay(this.attempt++);
      this.options.events.status?.("offline", delay);
      this.setTimer(() => {
        this.open();
      }, delay);
    });
  }

  private outdated(socket: SocketLike): void {
    this.closedByUser = true;
    this.socket = undefined;
    socket.close(1000);
    this.options.events.status?.("outdated");
  }

  private receive(message: ServerMessage): void {
    const { events } = this.options;
    switch (message.type) {
      case "welcome":
        this.attempt = 0;
        events.status?.("online");
        if (this.game) {
          this.send({ type: "rejoin", token: this.game.token, from: this.nextTick });
        } else if (this.entry) {
          this.send(this.entry);
        }
        return;
      case "lobby":
        events.lobby?.(message);
        return;
      case "started": {
        // A rejoin resends the start: the simulation keeps its state and only gets the missing turns.
        const rejoined = this.game?.game === message.game;
        this.game = message;
        if (!rejoined) {
          this.nextTick = 0;
          events.started?.(message);
        }
        return;
      }
      case "turns": {
        const fresh = message.turns.filter((turn) => turn.tick >= this.nextTick);
        if (fresh.length === 0) return;
        if ((fresh[0]?.tick ?? 0) > this.nextTick) {
          // A turn went missing: reconnect and ask for every turn from the gap on.
          this.socket?.close(1000);
          return;
        }
        this.nextTick = (fresh.at(-1)?.tick ?? this.nextTick) + 1;
        events.turns?.(fresh);
        return;
      }
      case "desync":
        events.desync?.(message.tick);
        return;
      case "ended":
        this.entry = undefined;
        this.game = undefined;
        events.ended?.(message.reason);
        return;
      case "error":
        if (message.code === "token_invalid" && this.game) {
          // The seat is gone: the game went on without this player.
          this.game = undefined;
          this.entry = undefined;
          events.ended?.("abandoned");
          return;
        }
        if (message.code === "token_in_use" && this.game) {
          // The server is checking the previous connection; ask again shortly.
          const game = this.game;
          this.setTimer(() => {
            if (this.game === game) {
              this.send({ type: "rejoin", token: game.token, from: this.nextTick });
            }
          }, 1_000);
          return;
        }
        events.error?.(message.code, message.message);
        return;
    }
  }
}
