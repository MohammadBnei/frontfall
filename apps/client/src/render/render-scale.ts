/** Highest pixel ratio the map is drawn at: a phone at 3 gains nothing a player can see for 2.25 times the work. */
export const MAX_PIXEL_RATIO = 2;
/** Lowest: below it the map turns soft, which beats a game that stutters. */
export const MIN_PIXEL_RATIO = 0.75;
/** Each step down keeps this share of the last one's pixels on each axis. */
const STEP = 0.8;
/** Frames drawn back to back that are looked at before deciding. */
const WINDOW = 24;
/** Under about 50 frames a second, more than half the frames miss the display: a step down. */
const SLOW_MS = 20;
/** At the display's pace, about 60 frames a second, over twice the window: a step back up. */
const FAST_MS = 18;
/** A step up that turns out too slow is not tried again for this long, twice as long after each failure. */
const HOLD_MS = 30_000;
const MAX_HOLD_MS = 8 * HOLD_MS;
/** A longer gap is not a frame: a hidden tab, a pause, a hiccup of the page. */
const GAP_MS = 1000;

/**
 * Picks the pixel ratio the map is drawn at from how long its frames take.
 * The map's shader runs once per pixel, and on a high-density screen a
 * laptop's GPU can fall short of the display's pace: the ratio then steps
 * down until frames keep up, and back up once they do with room to spare. A
 * step up that proves too slow is held off a while, so the map does not
 * flicker between two sharpnesses. Only frames drawn back to back count: while
 * nothing moves, no frame is drawn and nothing is learnt.
 */
export class RenderScale {
  private readonly levels: number[];
  private level = 0;
  /** The highest level (lowest index) a failed step up leaves allowed, until `heldUntil`. */
  private ceiling = 0;
  private heldUntil = 0;
  private hold = HOLD_MS;
  private intervals: number[] = [];
  private lastFrame: number | undefined;
  /** When the last step up was taken, to tell a failed one. */
  private raisedAt = -Infinity;

  constructor(devicePixelRatio: number) {
    const top = Math.min(MAX_PIXEL_RATIO, Math.max(devicePixelRatio, MIN_PIXEL_RATIO));
    this.levels = [top];
    for (let ratio = top * STEP; ratio > MIN_PIXEL_RATIO; ratio *= STEP) this.levels.push(ratio);
    if (top > MIN_PIXEL_RATIO) this.levels.push(MIN_PIXEL_RATIO);
  }

  get ratio(): number {
    return this.levels[this.level] as number;
  }

  /** Called every animation frame, `drawn` when the map was drawn in it. Whether the ratio changed. */
  frame(now: number, drawn: boolean): boolean {
    if (!drawn) {
      this.lastFrame = undefined;
      return false;
    }
    const last = this.lastFrame;
    this.lastFrame = now;
    if (last === undefined || now - last > GAP_MS) return false;
    this.intervals.push(now - last);
    if (this.intervals.length < WINDOW) return false;
    if (median(this.intervals.slice(-WINDOW)) > SLOW_MS && this.level < this.levels.length - 1) {
      // The level just left was too slow after all: stay below it a while.
      if (now - this.raisedAt < HOLD_MS / 3) {
        this.ceiling = this.level + 1;
        this.heldUntil = now + this.hold;
        this.hold = Math.min(MAX_HOLD_MS, 2 * this.hold);
      }
      return this.move(this.level + 1);
    }
    if (this.intervals.length < 2 * WINDOW) return false;
    const allowed = now < this.heldUntil ? this.ceiling : 0;
    if (median(this.intervals) < FAST_MS && this.level > allowed) {
      this.raisedAt = now;
      return this.move(this.level - 1);
    }
    this.intervals = this.intervals.slice(-WINDOW);
    return false;
  }

  private move(level: number): boolean {
    this.level = level;
    this.intervals = [];
    this.lastFrame = undefined;
    return true;
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] as number;
}
