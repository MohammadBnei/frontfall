import type { Order } from "@frontfall/engine";
import type { WorkerReply, WorkerRequest } from "./messages.ts";
import type { GameSession, SessionEvents } from "./session.ts";
import type { MapInfo } from "./maps.ts";
import type { SoloOptions } from "./solo-game.ts";

/**
 * A game played on this machine against bots. The simulation runs in a
 * worker so the page keeps drawing at full speed; orders go through the
 * same shape a networked game will use.
 */
export class LocalSession implements GameSession {
  private readonly worker: Worker;

  constructor(options: SoloOptions, map: MapInfo, events: SessionEvents) {
    this.worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (reply.type === "started") events.onStart(reply);
      else if (reply.type === "update") events.onUpdate(reply.update);
      else if (reply.type === "click") events.onClick(reply.tile, reply.outcome);
      else events.onError(reply.message);
    };
    this.worker.onerror = (event) => {
      events.onError(event.message);
    };
    this.post({ type: "start", options, map });
  }

  sendOrder(order: Order): void {
    this.post({ type: "order", order });
  }

  click(tile: number, ratio: number): void {
    this.post({ type: "click", tile, ratio });
  }

  setPaused(paused: boolean): void {
    this.post({ type: "pause", paused });
  }

  dispose(): void {
    this.post({ type: "stop" });
    this.worker.terminate();
  }

  private post(request: WorkerRequest): void {
    this.worker.postMessage(request);
  }
}
