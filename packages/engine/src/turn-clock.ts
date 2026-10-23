import type { Game, Order, Turn } from "./game.ts";

/**
 * Closes the orders of local players into numbered turns, as the server does
 * online, and runs them. It owns no timer: the caller decides when a tick is
 * due (an interval in the page, a loop in a test or a headless run).
 */
export class TurnClock {
  readonly game: Game;
  private pending: { player: number; order: Order }[] = [];

  constructor(game: Game) {
    this.game = game;
  }

  /** Queues an order for the next turn, after those already queued. */
  submit(player: number, order: Order): void {
    this.pending.push({ player, order });
  }

  /** Runs the next tick with every order queued since the last one, and returns its turn. */
  advance(): Turn {
    const turn: Turn = { tick: this.game.tick, orders: this.pending };
    this.pending = [];
    this.game.step(turn);
    return turn;
  }
}
