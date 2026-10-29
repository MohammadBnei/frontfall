import { HERE, type Place } from "./mix.ts";

/** Where a point is on the screen, and how the view stands, for `placeFor`. */
export interface Listening {
  /** Position of the sound on the screen in pixels, from the top left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Screen pixels per tile: small when the whole map is in view. */
  scale: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * How far above the map the player looks, from 0 (a few tiles fill the
 * screen) to 1 (the whole map is in view). A sound heard from up there is
 * softer, duller and more diffuse than one heard close.
 */
export function altitude(scale: number): number {
  return clamp(1 - Math.log2(Math.max(scale, 1)) / 4, 0, 1);
}

/**
 * Where a sound that happens at a point of the map is heard from. On screen it
 * is clear and panned to its side; the further it lies beyond the edge, the
 * quieter, duller and wetter it gets. The player's own doing is never lost
 * from hearing, whatever the view.
 */
export function placeFor(at: Listening, own: boolean): Place {
  // A view with no size yet, or a point that is not a number, has no side to come from.
  if (!(at.width > 0 && at.height > 0) || !Number.isFinite(at.x + at.y + at.scale)) {
    return placeHere(Number.isFinite(at.scale) ? at.scale : 1);
  }
  const nx = (at.x - at.width / 2) / (at.width / 2);
  const ny = (at.y - at.height / 2) / (at.height / 2);
  const off = Math.max(0, Math.max(Math.abs(nx), Math.abs(ny)) - 1);
  const far = clamp(off / 2.5, 0, 1);
  const high = altitude(at.scale);
  const gain = (1 - 0.65 * far) * (1 - 0.3 * high);
  return {
    // Far beyond the edge, or behind the globe, a sound has no clear side left.
    pan: clamp(nx, -1, 1) * (own ? 0.5 : 0.8) * (1 - 0.6 * far),
    gain: own ? Math.max(gain, 0.75) : gain,
    cutoff: Math.max(1800, 18000 * 0.14 ** far * (1 - 0.55 * high)),
    wet: clamp(0.2 + 0.4 * far + 0.2 * high, 0, 0.9),
  };
}

/** The place of a sound with none on the map, at the player's own screen. */
export function placeHere(scale: number): Place {
  return { ...HERE, wet: clamp(HERE.wet + 0.1 * altitude(scale), 0, 0.9) };
}
