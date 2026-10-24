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
let started = false;
let timer: ReturnType<typeof setInterval> | undefined;
let paused = false;
let pending: Order[] = [];

function tick(): void {
  if (!game || paused) return;
  const orders = pending;
  pending = [];
  const update = game.step(orders);
  // The game goes on once decided, for a player who keeps watching (R-WIN-03).
  scope.postMessage({ type: "update", update }, transferables(update));
}

async function start(request: Extract<WorkerRequest, { type: "start" }>): Promise<void> {
  // One game per worker: a second start would run two clocks on one game.
  if (started) throw new Error("the game has already started");
  started = true;
  const map = await fetchMapData(request.map);
  game = new SoloGame(request.options, map);
  const { ticksPerSecond, winSharePercent, maxDurationTicks, retreatPenaltyPercent } =
    game.game.balance;
  // The page draws the terrain too: it gets its own copy of the kinds, and
  // the relief, which only drawing uses.
  const view = { ...map, kinds: map.kinds.slice() };
  scope.postMessage(
    {
      type: "started",
      map: view,
      rules: {
        ownableTiles: game.ownableTiles,
        ticksPerSecond,
        winSharePercent,
        maxDurationTicks,
        retreatPenaltyPercent,
      },
    },
    [view.kinds.buffer, view.relief.buffer],
  );
  const speed = Math.max(1, Math.floor(request.options.speed ?? 1));
  timer = setInterval(() => {
    for (let i = 0; i < speed; i++) tick();
  }, 1000 / ticksPerSecond);
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
      if (!game) break;
      const result = game.orderForClick(request.tile, request.ratio);
      if ("order" in result) pending.push(result.order);
      const outcome = "order" in result ? result.order.type : result.refused;
      scope.postMessage({ type: "click", tile: request.tile, outcome });
      break;
    }
    case "pause":
      paused = request.paused;
      break;
    case "stop":
      clearInterval(timer);
      timer = undefined;
      game = undefined;
      break;
  }
};
