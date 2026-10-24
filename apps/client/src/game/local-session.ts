import type { DesyncReport, GameRecord, Order, Turn } from "@frontfall/engine";
import type { WorkerReply, WorkerRequest } from "./messages.ts";
import type { GameSession, SessionEvents } from "./session.ts";
import type { MapInfo } from "./maps.ts";
import type { ClickMode, SoloOptions } from "./solo-game.ts";

/** Where an online game's orders and state hashes go: the connection to the server. */
export interface ServerLink {
  order(order: Order): void;
  hash(tick: number, hash: number): void;
}

/**
 * A game simulated on this machine, in a worker so the page keeps drawing
 * at full speed. Solo, the worker runs its own clock and takes the orders.
 * Online, with a link to the server, orders go to the server, and the game
 * advances only with the turns it relays, passed in through `pushTurns`.
 */
export class LocalSession implements GameSession {
  private readonly worker: Worker;
  /** Callers waiting for a desync report, answered in order. */
  private readonly reports: ((report: DesyncReport | undefined) => void)[] = [];
  /** Callers waiting for a record of the game, answered in order. */
  private readonly records: ((record: GameRecord | undefined) => void)[] = [];

  constructor(
    options: SoloOptions,
    map: MapInfo,
    events: SessionEvents,
    private readonly link?: ServerLink,
  ) {
    this.worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (reply.type === "started") {
        events.onStart(reply);
      } else if (reply.type === "update") {
        for (const { tick, hash } of reply.update.hashes ?? []) link?.hash(tick, hash);
        events.onUpdate(reply.update);
      } else if (reply.type === "report") {
        this.reports.shift()?.(reply.report);
      } else if (reply.type === "record") {
        this.records.shift()?.(reply.record);
      } else if (reply.type === "click") {
        if (reply.order) link?.order(reply.order);
        events.onClick(reply.tile, reply.outcome);
      } else {
        events.onError(reply.message);
      }
    };
    this.worker.onerror = (event) => {
      events.onError(event.message);
    };
    this.post({ type: "start", options, map, online: link !== undefined });
  }

  sendOrder(order: Order): void {
    if (this.link) this.link.order(order);
    else this.post({ type: "order", order });
  }

  click(tile: number, ratio: number, mode: ClickMode = "attack"): void {
    this.post({ type: "click", tile, ratio, mode });
  }

  /** Online: turns from the server, consecutive, from the next tick on. */
  pushTurns(turns: Turn[]): void {
    this.post({ type: "turns", turns });
  }

  /** Online: the server flagged this client's hash after `tick`. */
  desync(tick: number, expected: number | null): void {
    this.post({ type: "desync", tick, expected });
  }

  /** Online: everything needed to replay the game so far; none on a generated map. */
  report(): Promise<DesyncReport | undefined> {
    return new Promise((resolve) => {
      this.reports.push(resolve);
      this.post({ type: "report" });
    });
  }

  /** The game so far, to watch again; none on a generated map or in a replay. */
  record(): Promise<GameRecord | undefined> {
    return new Promise((resolve) => {
      this.records.push(resolve);
      this.post({ type: "record" });
    });
  }

  /** Replay: ticks played per tick of time. */
  setSpeed(speed: number): void {
    this.post({ type: "speed", speed });
  }

  setPaused(paused: boolean): void {
    // An online game runs at the server's pace for everyone.
    if (!this.link) this.post({ type: "pause", paused });
  }

  dispose(): void {
    this.post({ type: "stop" });
    this.worker.terminate();
  }

  private post(request: WorkerRequest): void {
    this.worker.postMessage(request);
  }
}
