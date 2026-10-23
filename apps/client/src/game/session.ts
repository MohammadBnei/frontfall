import type { Order } from "@frontfall/engine";
import type { GameUpdate } from "./solo-game.ts";

export interface SessionEvents {
  onStart(info: { ownableTiles: number; ticksPerSecond: number }): void;
  /** Once per tick, in order. The game is over when `update.winner` is set. */
  onUpdate(update: GameUpdate): void;
  onError(message: string): void;
}

/**
 * A running game as the interface sees it. The solo game runs on this
 * machine; an online game will receive its turns from the server through
 * the same interface.
 */
export interface GameSession {
  /** Order of the local player, carried out on a coming tick. */
  sendOrder(order: Order): void;
  /** A click on the map, with the attack ratio in percent; the session picks the order. */
  click(tile: number, ratio: number): void;
  /** Solo only: online games never pause. */
  setPaused(paused: boolean): void;
  dispose(): void;
}
