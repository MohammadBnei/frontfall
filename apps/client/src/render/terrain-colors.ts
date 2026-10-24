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
  const { width, height, kinds, wrapsX } = options;
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
  // The elevation bands of the map file are steps: smoothed, they read as hills, not plateaus.
  const smooth = smoothRelief(options);
  const level = (x: number, y: number): number => smooth[at(x, y)] as number;

  const color: [number, number, number] = [0, 0, 0];
  for (let y = 0, tile = 0; y < height; y++) {
    for (let x = 0; x < width; x++, tile++) {
      const kind = kinds[tile] as number;
      const h = smooth[tile] as number;
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
        // Light from the north-west: slopes that face it lighten, the others darken.
        const slope = level(x - 1, y) - level(x + 1, y) + level(x, y - 1) - level(x, y + 1);
        let shade = Math.min(1.2, Math.max(0.8, 1 + slope * 0.04));
        // The shore is a tone lighter, so coasts read at any zoom.
        if (water(x + 1, y) || water(x - 1, y) || water(x, y + 1) || water(x, y - 1)) shade *= 1.18;
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

/**
 * Relief averaged over the 3 x 3 tiles around each tile, counting only tiles
 * on the same side of the coast, so sea depth never bleeds onto the land.
 * Box sums are separable: rows first, then columns, for land and sea apart.
 */
function smoothRelief(options: TerrainColorOptions): Float32Array {
  const { width, height, kinds, relief, wrapsX } = options;
  const size = width * height;
  const radius = 1;
  // Per side of the coast: the relief of the tile if it is on that side, and 1 if it is.
  const sums = [new Float32Array(size), new Float32Array(size)];
  const counts = [new Float32Array(size), new Float32Array(size)];
  for (let tile = 0; tile < size; tile++) {
    const side = kinds[tile] === 0 ? 1 : 0;
    (sums[side] as Float32Array)[tile] = relief[tile] as number;
    (counts[side] as Float32Array)[tile] = 1;
  }
  // Running sums along a line of tiles: each tile costs the same whatever the radius.
  // A line starts at `first`, steps by `step`, and wraps if `wraps`, else clamps.
  const line = (
    input: Float32Array,
    output: Float32Array,
    first: number,
    step: number,
    length: number,
    wraps: boolean,
  ): void => {
    const index = (i: number): number =>
      first + step * (wraps ? (i + length) % length : Math.min(length - 1, Math.max(0, i)));
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += input[index(k)] as number;
    for (let i = 0, tile = first; i < length; i++, tile += step) {
      output[tile] = sum;
      const add = i + radius + 1 < length ? tile + step * (radius + 1) : index(i + radius + 1);
      const drop = i - radius >= 0 ? tile - step * radius : index(i - radius);
      sum += (input[add] as number) - (input[drop] as number);
    }
  };
  const blur = (input: Float32Array): Float32Array => {
    const rows = new Float32Array(size);
    for (let y = 0; y < height; y++) line(input, rows, y * width, 1, width, wrapsX);
    const output = new Float32Array(size);
    for (let x = 0; x < width; x++) line(rows, output, x, width, height, false);
    return output;
  };
  const out = new Float32Array(size);
  for (let tile = 0; tile < size; tile++) out[tile] = relief[tile] as number;
  for (const side of [0, 1]) {
    const sum = blur(sums[side] as Float32Array);
    const count = blur(counts[side] as Float32Array);
    for (let tile = 0; tile < size; tile++) {
      if ((kinds[tile] === 0 ? 1 : 0) === side)
        out[tile] = (sum[tile] as number) / (count[tile] as number);
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
