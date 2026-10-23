import type { Order } from "@frontfall/engine";
import { transferables, type WorkerReply, type WorkerRequest } from "./messages.ts";
import { SoloGame } from "./solo-game.ts";

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

let game: SoloGame | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let paused = false;
let pending: Order[] = [];

function tick(): void {
  if (!game || paused) return;
  const orders = pending;
  pending = [];
  const update = game.step(orders);
  scope.postMessage({ type: "update", update }, transferables(update));
  if (update.winner !== undefined && timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  switch (request.type) {
    case "start": {
      try {
        game = new SoloGame(request.options);
      } catch (error) {
        scope.postMessage({ type: "error", message: String(error) });
        return;
      }
      const { ticksPerSecond } = game.game.balance;
      scope.postMessage({ type: "started", ownableTiles: game.ownableTiles, ticksPerSecond });
      timer = setInterval(tick, 1000 / ticksPerSecond);
      break;
    }
    case "order":
      pending.push(request.order);
      break;
    case "click": {
      const order = game?.orderForClick(request.tile, request.ratio);
      if (order) pending.push(order);
      break;
    }
    case "pause":
      paused = request.paused;
      break;
  }
};
