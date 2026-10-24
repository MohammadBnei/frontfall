import { MAP_COLORS } from "../palette.ts";

/** Secondary text of the brand: light enough to read as rock and ice. */
const SLATE = "#8DA2B6";
/** Shallow sea over the continental shelf, a step lighter than the brand's ocean. */
const SHELF = "#163A52";
/** Uplands, between the brand's high land and its slate. */
const HIGHLAND = "#6E7A62";

/** Bits of the alpha channel: which sides of a water tile touch land, for the surf line. */
export const SURF_EAST = 1;
export const SURF_WEST = 2;
export const SURF_SOUTH = 4;
export const SURF_NORTH = 8;

export interface TerrainColorOptions {
  readonly width: number;
  readonly height: number;
  /** TileKind of every tile: 0 water, 1 plains, 2 hills, 3 mountains, 4 impassable. */
  readonly kinds: Uint8Array;
  /** Elevation band on land, depth band on water, 0 to 31. */
  readonly relief: Uint8Array;
  readonly wrapsX: boolean;
}

/**
 * The colour of every tile's ground, computed once: shallow and deep sea,
 * lowlands rising to uplands and rock, lit from the north-west by the slope
 * between neighbours. RGB is sRGB, one texel per tile; alpha holds the
 * SURF_* bits, so the shader draws the coast line inside water tiles without
 * reading their neighbours each frame.
 */
export function bakeTerrainColors(options: TerrainColorOptions): Uint8Array {
  const { width, height, kinds, relief, wrapsX } = options;
  const out = new Uint8Array(width * height * 4);
  const shelf = linear(SHELF);
  const deep = linear(MAP_COLORS.oceanDeep);
  const land = linear(MAP_COLORS.land);
  const high = linear(HIGHLAND);
  const peak = linear(SLATE);
  const column = (x: number): number =>
    wrapsX ? (x + width) % width : Math.min(width - 1, Math.max(0, x));
  const row = (y: number): number => Math.min(height - 1, Math.max(0, y));
  const at = (x: number, y: number): number => row(y) * width + column(x);
  const water = (x: number, y: number): boolean => kinds[at(x, y)] === 0;
  // Relief halfway between the tiles one and two steps away, as a bilinear read would give.
  const away = (x: number, y: number, dx: number, dy: number): number =>
    ((relief[at(x + dx, y + dy)] as number) + (relief[at(x + 2 * dx, y + 2 * dy)] as number)) / 2;

  const color: [number, number, number] = [0, 0, 0];
  for (let y = 0, tile = 0; y < height; y++) {
    for (let x = 0; x < width; x++, tile++) {
      const kind = kinds[tile] as number;
      const h = relief[tile] as number;
      let surf = 0;
      if (kind === 0) {
        mix(shelf, deep, smoothstep(0, 6, h), color);
        if (!water(x + 1, y)) surf |= SURF_EAST;
        if (!water(x - 1, y)) surf |= SURF_WEST;
        if (!water(x, y + 1)) surf |= SURF_SOUTH;
        if (!water(x, y - 1)) surf |= SURF_NORTH;
      } else {
        if (kind === 4) {
          color[0] = peak[0];
          color[1] = peak[1];
          color[2] = peak[2];
        } else {
          const upland: [number, number, number] = [0, 0, 0];
          mix(high, peak, smoothstep(18, 30, h), upland);
          mix(land, upland, smoothstep(0, 18, h), color);
        }
        const slope = away(x, y, -1, 0) - away(x, y, 1, 0) + away(x, y, 0, -1) - away(x, y, 0, 1);
        const shade = Math.min(1.35, Math.max(0.65, 1 + slope * 0.06));
        color[0] *= shade;
        color[1] *= shade;
        color[2] *= shade;
      }
      out[tile * 4] = toSrgbByte(color[0]);
      out[tile * 4 + 1] = toSrgbByte(color[1]);
      out[tile * 4 + 2] = toSrgbByte(color[2]);
      out[tile * 4 + 3] = surf;
    }
  }
  return out;
}

function linear(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [toLinear((value >> 16) & 0xff), toLinear((value >> 8) & 0xff), toLinear(value & 0xff)];
}

function toLinear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toSrgbByte(value: number): number {
  const c = Math.min(1, Math.max(0, value));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(
  a: readonly number[],
  b: readonly number[],
  t: number,
  out: [number, number, number],
): [number, number, number] {
  out[0] = (a[0] as number) + ((b[0] as number) - (a[0] as number)) * t;
  out[1] = (a[1] as number) + ((b[1] as number) - (a[1] as number)) * t;
  out[2] = (a[2] as number) + ((b[2] as number) - (a[2] as number)) * t;
  return out;
}
