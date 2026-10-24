import type { Order } from "@frontfall/engine";
import type { MapData, MapInfo } from "./maps.ts";
import type { GameUpdate, SoloOptions } from "./solo-game.ts";

/** What the interface shows of the rules of a game, from the engine's balance. */
export interface GameRules {
  readonly ownableTiles: number;
  readonly ticksPerSecond: number;
  /** B-WIN-SHARE: share of the ownable land that wins, in percent. */
  readonly winSharePercent: number;
  /** B-MAX-DURATION: the leader wins when the game reaches it. */
  readonly maxDurationTicks: number;
}

/** From the page to the simulation worker. */
export type WorkerRequest =
  | { type: "start"; options: SoloOptions; map: MapInfo }
  | { type: "order"; order: Order }
  /** A click on the map, turned into an order by the worker, which knows the game. */
  | { type: "click"; tile: number; ratio: number }
  | { type: "pause"; paused: boolean };

/** From the simulation worker to the page. */
export type WorkerReply =
  | { type: "started"; map: MapData; rules: GameRules }
  | { type: "update"; update: GameUpdate }
  | { type: "error"; message: string };

/** Buffers of an update, handed over to the page instead of copied. */
export function transferables(update: GameUpdate): ArrayBuffer[] {
  const buffers = [update.changedTiles.buffer, update.changedOwners.buffer];
  if (update.owners) buffers.push(update.owners.buffer);
  return buffers as ArrayBuffer[];
}
