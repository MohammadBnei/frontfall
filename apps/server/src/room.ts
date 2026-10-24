import {
  encodeServerMessage,
  encodeTurnsFrame,
  HASH_INTERVAL,
  TICK_RATE,
  type Difficulty,
  type ErrorCode,
  type Frame,
  type GameOptions,
  type Order,
  type PlayerInfo,
  type ServerMessage,
  type Turn,
} from "@frontfall/protocol";
import { newToken } from "./ids.ts";
import { TurnLog } from "./turn-log.ts";

/** The connection of one player, as the room sees it. */
export interface Peer {
  send(frame: Frame): void;
  /** Asks the connection to prove it is alive, and drops it if it does not answer. */
  probe(): void;
}

export interface RoomSettings {
  visibility: "public" | "private";
  map: string;
  capacity: number;
  /** Bots added by every client at the start; the server never sees their orders. */
  bots: number;
  difficulty: Difficulty;
  /** Public games: players needed before the countdown starts. */
  minPlayers: number;
  /** Public games: wait after reaching minPlayers, unless the game fills up first. */
  countdownMs: number;
  /** How long a seat stays reserved for a player whose connection dropped. */
  reconnectGraceMs: number;
  /** A game still running after this long is stopped. */
  maxDurationMs: number;
  /** A game that has not started this long after it opened is closed. */
  lobbyTimeoutMs: number;
  /** Orders one player may add to one turn; more are dropped. */
  maxOrdersPerTurn: number;
  /** A game whose turn log grows past this many bytes is stopped. */
  maxLogBytes: number;
}

export type RoomState = "open" | "starting" | "running" | "finished";

export type FinishReason = "abandoned" | "timeout" | "expired" | "empty";

export interface Seat {
  /** Number shown in the lobby, replaced by the final player number at start. */
  id: number;
  readonly name: string;
  readonly token: string;
  peer: Peer | undefined;
  /** When the connection dropped, while the game runs. */
  awaySince: number | undefined;
  /** Left for good: the seat cannot be taken back. */
  gone: boolean;
  /** Orders added to the turn being filled. */
  orders: number;
}

/** Receives what happens in a room, for logs and metrics. */
export interface RoomObserver {
  started?(room: Room): void;
  finished?(room: Room, reason: FinishReason): void;
  /** `hash` is the flagged players' hash, `expected` the majority's, if any. */
  desync?(room: Room, tick: number, hash: number, expected: number | undefined): void;
}

/**
 * Ticks during which hashes for one tick are collected. Clients that are
 * behind report late; whoever has not reported by then is left out.
 */
const HASH_WINDOW_TICKS = 600;

/**
 * One game, from the first player in its lobby to its end. The room never
 * simulates the game: it numbers turns, keeps their log and relays them, so
 * that every client replays the same orders in the same order.
 */
export class Room {
  private stateValue: RoomState = "open";
  private readonly seats: Seat[] = [];
  private nextLobbyId = 1;
  private host: Seat | undefined;
  private startsAt: number | undefined;
  private openedAt: number | undefined;
  private startedAt = 0;
  private pending: Turn["orders"] = [];
  /** Hashes reported for each checked tick, by seat. */
  private readonly hashes = new Map<number, Map<Seat, number>>();
  /** Seats found out of step, with the first tick they disagreed on. */
  private readonly desyncs = new Map<Seat, number>();
  readonly log = new TurnLog();

  constructor(
    readonly id: string,
    settings: RoomSettings,
    readonly seed: number,
    private readonly observer: RoomObserver = {},
    /** Address of the player who opened the game, for per-address limits. */
    readonly owner?: string,
  ) {
    // Copied: the host of a private game changes its own map and bots.
    this.settings = { ...settings };
  }

  readonly settings: RoomSettings;

  get state(): RoomState {
    return this.stateValue;
  }

  get playerCount(): number {
    return this.seats.filter((seat) => !seat.gone).length;
  }

  get connectedCount(): number {
    return this.seats.filter((seat) => seat.peer).length;
  }

  get desynced(): boolean {
    return this.desyncs.size > 0;
  }

  /** True while the seat belongs to this room and can act in it. */
  holds(seat: Seat): boolean {
    return this.stateValue !== "finished" && !seat.gone && this.seats.includes(seat);
  }

  seatFor(token: string): Seat | undefined {
    return this.seats.find((seat) => seat.token === token && !seat.gone);
  }

  /** Milliseconds before the countdown ends, or null when none runs. */
  startsIn(now: number): number | null {
    return this.startsAt === undefined ? null : Math.max(0, Math.ceil(this.startsAt - now));
  }

  join(name: string, peer: Peer, now: number): Seat | ErrorCode {
    if (this.stateValue === "running" || this.stateValue === "finished") return "game_started";
    if (this.seats.length >= this.settings.capacity) return "game_full";
    const seat: Seat = {
      id: this.nextLobbyId++,
      name,
      token: newToken(),
      peer,
      awaySince: undefined,
      gone: false,
      orders: 0,
    };
    this.seats.push(seat);
    this.openedAt ??= now;
    if (this.settings.visibility === "private") this.host ??= seat;
    this.lobbyChanged(now);
    return seat;
  }

  /** The player leaves for good. Before the start, their seat is freed. */
  leave(seat: Seat, now: number): void {
    if (!this.holds(seat)) return;
    if (this.stateValue === "running") {
      seat.gone = true;
      seat.peer = undefined;
      return;
    }
    this.seats.splice(this.seats.indexOf(seat), 1);
    seat.gone = true;
    seat.peer = undefined;
    if (this.host === seat) this.host = this.seats[0];
    if (this.seats.length === 0) {
      this.finish("empty");
      return;
    }
    this.lobbyChanged(now);
  }

  /** The connection dropped. In a running game, the seat waits for the player to rejoin. */
  disconnect(seat: Seat, now: number): void {
    if (this.stateValue !== "running") {
      this.leave(seat, now);
      return;
    }
    if (!this.holds(seat)) return;
    seat.peer = undefined;
    seat.awaySince = now;
  }

  /** Gives the seat to a new connection and sends every turn from `from` on. */
  rejoin(seat: Seat, peer: Peer, from: number): ErrorCode | undefined {
    if (this.stateValue !== "running" || !this.holds(seat)) return "token_invalid";
    if (seat.peer) {
      seat.peer.probe();
      return "token_in_use";
    }
    seat.peer = peer;
    seat.awaySince = undefined;
    peer.send(this.startedMessage(seat));
    for (const frame of this.log.frames(Math.min(from, this.log.length))) peer.send(frame);
    const desync = this.desyncs.get(seat);
    if (desync !== undefined) peer.send(encodeServerMessage({ type: "desync", tick: desync }));
    return undefined;
  }

  /** Host of a private game: map, bots and difficulty, until the start. */
  configure(seat: Seat, options: GameOptions, now: number): ErrorCode | undefined {
    if (!this.holds(seat)) return "not_in_game";
    if (this.stateValue === "running") return "game_started";
    if (this.host !== seat) return "not_host";
    Object.assign(this.settings, options);
    this.lobbyChanged(now);
    return undefined;
  }

  /** Host of a private game: start now, whoever has joined. */
  requestStart(seat: Seat, now: number): ErrorCode | undefined {
    if (!this.holds(seat)) return "not_in_game";
    if (this.stateValue === "running") return "game_started";
    if (this.host !== seat) return "not_host";
    this.start(now);
    return undefined;
  }

  submit(seat: Seat, order: Order): boolean {
    if (this.stateValue !== "running" || !this.holds(seat) || !seat.peer) return false;
    if (seat.orders >= this.settings.maxOrdersPerTurn) return false;
    seat.orders++;
    this.pending.push({ player: seat.id, order });
    return true;
  }

  /**
   * Records the hash of a client's state after `tick`. Once every connected
   * player has reported, or the window has passed, the hashes are compared.
   */
  reportHash(seat: Seat, tick: number, hash: number): void {
    if (this.stateValue !== "running" || !this.holds(seat) || tick % HASH_INTERVAL !== 0) return;
    if (tick >= this.log.length || tick < this.log.length - HASH_WINDOW_TICKS) return;
    let reports = this.hashes.get(tick);
    if (!reports) {
      reports = new Map();
      this.hashes.set(tick, reports);
    }
    if (reports.has(seat)) return;
    reports.set(seat, hash);
    if (this.seats.every((other) => !other.peer || reports.has(other))) this.compare(tick);
  }

  /**
   * Flags the players whose hash differs from the majority's. A client
   * cannot mark others out of step by lying: it only singles itself out,
   * unless no majority exists, as with two players who disagree.
   */
  private compare(tick: number): void {
    const reports = this.hashes.get(tick);
    this.hashes.delete(tick);
    if (!reports) return;
    const votes = new Map<number, number>();
    for (const hash of reports.values()) votes.set(hash, (votes.get(hash) ?? 0) + 1);
    if (votes.size < 2) return;
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [first, second] = ranked;
    const majority = first && second && first[1] > second[1] ? first[0] : undefined;
    const firstDesync = this.desyncs.size === 0;
    let flagged: number | undefined;
    for (const [seat, hash] of reports) {
      if (hash === majority || this.desyncs.has(seat)) continue;
      this.desyncs.set(seat, tick);
      seat.peer?.send(encodeServerMessage({ type: "desync", tick }));
      flagged ??= hash;
    }
    if (firstDesync && flagged !== undefined) this.observer.desync?.(this, tick, flagged, majority);
  }

  /** Runs once per tick of the server: countdown, turn, timeouts. */
  update(now: number): void {
    switch (this.stateValue) {
      case "open":
      case "starting":
        if (this.startsAt !== undefined && now >= this.startsAt) this.start(now);
        else if (
          this.openedAt !== undefined &&
          now - this.openedAt >= this.settings.lobbyTimeoutMs
        ) {
          this.finish("expired");
        }
        return;
      case "running":
        this.closeTurn();
        this.compareLateHashes();
        this.expireSeats(now);
        return;
      default:
        return;
    }
  }

  /** Stops the game at once, for example when the server shuts down. */
  stop(): void {
    if (this.stateValue !== "finished") this.finish("abandoned");
  }

  private start(now: number): void {
    this.stateValue = "running";
    this.startsAt = undefined;
    this.startedAt = now;
    this.seats.forEach((seat, index) => {
      seat.id = index + 1;
    });
    for (const seat of this.seats) seat.peer?.send(this.startedMessage(seat));
    this.observer.started?.(this);
  }

  private closeTurn(): void {
    const tick = this.log.length;
    const body = this.log.append(this.pending);
    this.pending = [];
    for (const seat of this.seats) seat.orders = 0;
    this.broadcast(encodeTurnsFrame(tick, [body]));
  }

  private compareLateHashes(): void {
    for (const tick of this.hashes.keys()) {
      if (tick >= this.log.length - HASH_WINDOW_TICKS) continue;
      this.compare(tick);
    }
  }

  private expireSeats(now: number): void {
    for (const seat of this.seats) {
      if (seat.awaySince !== undefined && now - seat.awaySince >= this.settings.reconnectGraceMs) {
        seat.gone = true;
        seat.awaySince = undefined;
      }
    }
    if (this.seats.every((seat) => seat.gone)) this.finish("abandoned");
    else if (
      now - this.startedAt >= this.settings.maxDurationMs ||
      this.log.byteLength >= this.settings.maxLogBytes
    ) {
      this.finish("timeout");
    }
  }

  private finish(reason: FinishReason): void {
    this.stateValue = "finished";
    if (reason !== "empty") this.broadcast(encodeServerMessage({ type: "ended", reason }));
    for (const seat of this.seats) seat.peer = undefined;
    this.pending = [];
    this.observer.finished?.(this, reason);
  }

  private lobbyChanged(now: number): void {
    if (this.settings.visibility === "public") {
      const count = this.seats.length;
      if (count >= this.settings.capacity) {
        this.start(now);
        return;
      }
      if (count >= this.settings.minPlayers) this.startsAt ??= now + this.settings.countdownMs;
      else this.startsAt = undefined;
      this.stateValue = this.startsAt === undefined ? "open" : "starting";
    }
    const players = this.players();
    const startsIn = this.startsIn(now);
    for (const seat of this.seats) {
      seat.peer?.send(
        encodeServerMessage({
          type: "lobby",
          game: this.id,
          visibility: this.settings.visibility,
          map: this.settings.map,
          bots: this.settings.bots,
          difficulty: this.settings.difficulty,
          capacity: this.settings.capacity,
          players,
          you: seat.id,
          host: this.host?.id ?? null,
          startsIn,
        }),
      );
    }
  }

  private startedMessage(seat: Seat): Frame {
    return encodeServerMessage({
      type: "started",
      game: this.id,
      map: this.settings.map,
      seed: this.seed,
      bots: this.settings.bots,
      difficulty: this.settings.difficulty,
      tickRate: TICK_RATE,
      players: this.players(),
      you: seat.id,
      token: seat.token,
    } satisfies ServerMessage);
  }

  private players(): PlayerInfo[] {
    return this.seats.map(({ id, name }) => ({ id, name }));
  }

  private broadcast(frame: Frame): void {
    for (const seat of this.seats) seat.peer?.send(frame);
  }
}
