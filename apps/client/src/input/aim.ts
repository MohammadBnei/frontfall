/**
 * How far from the coast or the sea a click may land and still aim at it,
 * in CSS pixels: a mouse points within a few pixels, a fingertip covers more.
 * On World at the zoom that shows it all a tile is under a pixel, so a fixed
 * count of tiles would leave only a pixel or two either side of the coast.
 */
export const AIM_PIXELS = 24;
export const AIM_PIXELS_FINGER = 40;
/** Fewest tiles a click reaches, zoomed in: as far as a port click always reached. */
export const AIM_MIN_TILES = 8;
/** Most tiles a click reaches, zoomed out: bounds the tiles a click looks through. */
export const AIM_MAX_TILES = 64;

/** Tiles around a click that still aim at the coast or the sea, at `scale` screen pixels per tile. */
export function aimReach(scale: number, finger = false): number {
  const pixels = finger ? AIM_PIXELS_FINGER : AIM_PIXELS;
  if (!(scale > 0)) return AIM_MAX_TILES;
  return Math.min(AIM_MAX_TILES, Math.max(AIM_MIN_TILES, Math.ceil(pixels / scale)));
}
