import type { Order } from "@frontfall/engine";
import type { MapData } from "./maps.ts";
import type { ClickOutcome, GameRules } from "./messages.ts";
import type { GameUpdate } from "./solo-game.ts";

export interface SessionEvents {
  /** The map is loaded and the first tick is coming. */
  onStart(info: { map: MapData; rules: GameRules; you: number }): void;
  /** Once per tick, in order. The game is over when `update.winner` is set. */
  onUpdate(update: GameUpdate): void;
  /** What a click sent through `click` turned into. */
  onClick(tile: number, outcome: ClickOutcome): void;
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
