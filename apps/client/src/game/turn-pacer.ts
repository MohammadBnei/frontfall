import type { Turn } from "@frontfall/engine";

/** A batch of more beats than this is a backlog (a stall, a hidden tab, a rejoin), not jitter. */
const MAX_BACKLOG = 4;
/** Recent turns whose delay sets how long turns are held back. */
const WINDOW = 30;

/**
 * A jitter buffer for an online game's turns. The server runs one turn per
 * tick, but the network bunches them: two arrive together, then none for a
 * while. The pacer plays turn n at a fixed offset from n ticks of the clock,
 * the largest delay among recent turns, so turns come out one per tick
 * whatever the jitter, at the price of that delay. A backlog is played at
 * once, and the delay is measured afresh from its last turn.
 */
export class TurnPacer {
  private queue: Turn[] = [];
  /** Arrival time minus scheduled time, for the last turns. */
  private delays: number[] = [];

  constructor(
    private readonly play: (turns: Turn[]) => void,
    private readonly intervalMs: number,
    /** Turns the server sends at each beat (R-MODE-07). */
    private readonly perBeat = 1,
  ) {}

  /** Turns from the server, in order, received at `now`. */
  push(turns: readonly Turn[], now: number): void {
    if (turns.length === 0) return;
    if (turns.length > MAX_BACKLOG * this.perBeat) {
      this.play([...this.queue.splice(0), ...turns]);
      const last = turns[turns.length - 1] as Turn;
      this.delays = [now - last.tick * this.intervalMs];
      return;
    }
    for (const turn of turns) {
      this.queue.push(turn);
      this.delays.push(now - turn.tick * this.intervalMs);
    }
    if (this.delays.length > WINDOW) this.delays.splice(0, this.delays.length - WINDOW);
  }

  /** Call often, once per frame: plays the turns due at `now`. */
  update(now: number): void {
    if (this.queue.length === 0) return;
    const offset = Math.max(...this.delays);
    let due = 0;
    while (
      due < this.queue.length &&
      (this.queue[due] as Turn).tick * this.intervalMs + offset <= now
    ) {
      due++;
    }
    if (due > 0) this.play(this.queue.splice(0, due));
  }

  get pending(): number {
    return this.queue.length;
  }
}
