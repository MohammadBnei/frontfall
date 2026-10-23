import type { Order } from "@frontfall/engine";
import { transferables, type WorkerReply, type WorkerRequest } from "./messages.ts";
import { fetchMapData } from "./maps.ts";
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

async function start(request: Extract<WorkerRequest, { type: "start" }>): Promise<void> {
  const map = await fetchMapData(request.map);
  game = new SoloGame(request.options, map);
  const { ticksPerSecond } = game.game.balance;
  // The page draws the terrain too: it gets its own copy.
  const view = { ...map, kinds: map.kinds.slice() };
  scope.postMessage(
    { type: "started", map: view, ownableTiles: game.ownableTiles, ticksPerSecond },
    [view.kinds.buffer],
  );
  timer = setInterval(tick, 1000 / ticksPerSecond);
}

scope.onmessage = (event) => {
  const request = event.data;
  switch (request.type) {
    case "start":
      start(request).catch((error: unknown) => {
        scope.postMessage({ type: "error", message: String(error) });
      });
      break;
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
