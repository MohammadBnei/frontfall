import {
  encodeClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  TICK_RATE,
  type ClientMessage,
  type Order,
  type ServerMessage,
} from "@frontfall/protocol";
import WebSocket from "ws";
import { Histogram } from "./histogram.ts";

/** Interval the server closes turns at. */
export const TURN_MS = 1000 / TICK_RATE;

/** Clients send a state hash every this many ticks, like the real client. */
const HASH_EVERY = 50;

/** What every client of one game measured. Shared by the clients of the game. */
export class GameStats {
  /** Time between two consecutive turn frames on one client. */
  readonly intervals = new Histogram();
  /** Time from sending an order to receiving the turn that holds it. */
  readonly orderLatency = new Histogram();
  /** Frames whose first tick was not the one after the previous frame. */
  outOfOrder = 0;
  desyncs = 0;
  ordersSent = 0;
  ordersSeen = 0;
  /** Turns each client had received when the run stopped. */
  readonly turnsPerClient: number[] = [];

  constructor(readonly id: string) {}
}

type Message<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>;

export interface ClientOptions {
  url: string;
  name: string;
  /**
   * Sent as X-Client-IP so that every simulated player counts as its own
   * address. A reverse proxy in front of the server overwrites it, in which
   * case its per-address connection limit applies to the whole run.
   */
  address: string;
  /** Picks the stats of a game when it starts. */
  statsFor: (game: string) => GameStats;
}

/**
 * One simulated player: it speaks protocol v1 like the browser client, sends
 * orders at a human pace and checks every turn it receives.
 */
export class LoadClient {
  private readonly inbox: ServerMessage[] = [];
  private readonly waiters: (() => void)[] = [];
  private readonly sentAt: number[] = [];
  private nextTick = 0;
  private lastFrameAt: number | undefined;
  private orderTimer: NodeJS.Timeout | undefined;
  private you = 0;
  private stats: GameStats | undefined;
  private closedWith: number | undefined;
  turns = 0;

  private constructor(
    private readonly socket: WebSocket,
    private readonly options: ClientOptions,
  ) {
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      this.receive(isBinary ? new Uint8Array(data) : data.toString("utf8"));
    });
    socket.on("close", (code: number) => {
      this.closedWith = code;
      this.wake();
    });
  }

  /** Connects and says hello. */
  static async connect(options: ClientOptions): Promise<LoadClient> {
    const socket = new WebSocket(options.url, { headers: { "x-client-ip": options.address } });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => {
        resolve();
      });
      socket.once("error", reject);
    });
    const client = new LoadClient(socket, options);
    client.send({ type: "hello", version: PROTOCOL_VERSION, name: options.name });
    await client.next("welcome");
    return client;
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(encodeClientMessage(message));
  }

  /** Waits for the next message of this type; messages of other types stay in the inbox. */
  async next<T extends ServerMessage["type"]>(type: T, timeoutMs = 15_000): Promise<Message<T>> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      const index = this.inbox.findIndex((message) => message.type === type);
      if (index >= 0) return this.inbox.splice(index, 1)[0] as Message<T>;
      const error = this.inbox.find((message) => message.type === "error");
      if (error) throw new Error(`${this.options.name}: server answered ${error.code}`);
      if (this.closedWith !== undefined) {
        throw new Error(`${this.options.name}: closed with ${String(this.closedWith)}`);
      }
      const left = deadline - performance.now();
      if (left <= 0)
        throw new Error(`${this.options.name}: no ${type} within ${String(timeoutMs)} ms`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /**
   * Sends random orders until stopped, one every `intervalMs` on average:
   * first a spawn, then attacks on random tiles of a `mapTiles` map.
   */
  play(intervalMs: number, mapTiles: number): void {
    let spawned = false;
    const schedule = () => {
      this.orderTimer = setTimeout(
        () => {
          const tile = Math.floor(Math.random() * mapTiles);
          const order: Order = spawned
            ? { type: "attack", target: tile, troops: 1 + Math.floor(Math.random() * 5000) }
            : { type: "spawn", tile };
          spawned = true;
          this.order(order);
          schedule();
        },
        intervalMs * (0.5 + Math.random()),
      );
    };
    schedule();
  }

  /** Stops sending orders and leaves the game, so the server can close it at once. */
  stop(): void {
    clearTimeout(this.orderTimer);
    this.stats?.turnsPerClient.push(this.turns);
    this.send({ type: "leave" });
    this.socket.close();
  }

  private order(order: Order): void {
    if (!this.stats || this.socket.readyState !== WebSocket.OPEN) return;
    this.sentAt.push(performance.now());
    this.stats.ordersSent++;
    this.send({ type: "order", order });
  }

  private receive(frame: string | Uint8Array): void {
    const parsed = parseServerMessage(frame);
    if (!parsed.ok) throw new Error(`${this.options.name}: invalid frame: ${parsed.error}`);
    const message = parsed.value;
    if (message.type === "turns") {
      this.receiveTurns(message);
      return;
    }
    if (message.type === "started") {
      // Set before the first turn, which can arrive in the same read.
      this.you = message.you;
      this.stats = this.options.statsFor(message.game);
    }
    if (message.type === "desync" && this.stats) this.stats.desyncs++;
    this.inbox.push(message);
    this.wake();
  }

  private receiveTurns(message: Message<"turns">): void {
    const stats = this.stats;
    if (!stats) throw new Error(`${this.options.name}: turns before the game started`);
    const now = performance.now();
    if (this.lastFrameAt !== undefined) stats.intervals.record(now - this.lastFrameAt);
    this.lastFrameAt = now;
    if (message.turns[0]?.tick !== this.nextTick) stats.outOfOrder++;
    for (const turn of message.turns) {
      this.nextTick = turn.tick + 1;
      this.turns++;
      for (const { player } of turn.orders) {
        if (player !== this.you) continue;
        const sentAt = this.sentAt.shift();
        if (sentAt !== undefined) stats.orderLatency.record(now - sentAt);
        stats.ordersSeen++;
      }
      if (turn.tick > 0 && turn.tick % HASH_EVERY === 0) {
        // Every client reports the same hash, so a desync would be the server's doing.
        this.send({ type: "hash", tick: turn.tick, hash: Math.imul(turn.tick, 0x9e3779b1) >>> 0 });
      }
    }
  }

  private wake(): void {
    for (const wake of this.waiters.splice(0)) wake();
  }
}
