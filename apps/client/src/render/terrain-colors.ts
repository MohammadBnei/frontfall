import { MAP_COLORS } from "../palette.ts";

/** Terrain tones beyond the brand's land and ocean; mirrored in assets/brand/tokens.json. */
export const TERRAIN_COLORS = {
  landLight: "#8A8E68",
  seaShallow: "#1F5878",
  foam: "#BFE0F0",
} as const;
/**
 * Bare rock, a darkened slate: light enough to read as rock, dark enough
 * that the pale player colours (sand, snow, mint) keep a contrast of about
 * 2:1 against it at its most lit.
 */
const ROCK = "#6A7C8E";
/** Tiles of open water over which the shallows fade into the deep. */
const SHALLOWS = 30;

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
  const shallow = linear(TERRAIN_COLORS.seaShallow);
  const deep = linear(MAP_COLORS.oceanDeep);
  const foam = linear(TERRAIN_COLORS.foam);
  const land = linear(MAP_COLORS.land);
  const light = linear(TERRAIN_COLORS.landLight);
  const peak = linear(ROCK);
  const distance = seaDistance(options);
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
        // Depth follows the distance from the coast, so the sea darkens gradually
        // (the map's own depth bands are steps); a pale halo marks the shallows.
        const d = distance[tile] as number;
        mix(shallow, deep, smoothstep(0, SHALLOWS, d), color);
        mix(color, foam, Math.min(1, Math.max(0, (3 - d) / 3)) * 0.16, color);
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
          mix(land, light, smoothstep(0, 24, h) * 0.6, upland);
          mix(upland, peak, smoothstep(26, 31, h), color);
        }
        // Light from the north-west: slopes that face it lighten, the others darken.
        const slope = level(x - 1, y) - level(x + 1, y) + level(x, y - 1) - level(x, y + 1);
        // A little grain per tile keeps close-ups from looking flat.
        const grain = (Math.imul(tile, 0x9e3779b1) >>> 24) / 255 - 0.5;
        let shade = Math.min(1.25, Math.max(0.7, 1 + slope * 0.035 + grain * 0.07));
        // The shore is a tone lighter, so coasts read at any zoom.
        if (water(x + 1, y) || water(x - 1, y) || water(x, y + 1) || water(x, y - 1)) {
          shade = Math.min(1.25, shade * 1.15);
        }
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
 * Distance of every water tile from the nearest land, in tiles (the walking
 * distance along rows and columns, so coasts round off a little); 0 on land.
 */
function seaDistance(options: TerrainColorOptions): Uint16Array {
  const { width, height, kinds, wrapsX } = options;
  const out = new Uint16Array(width * height);
  for (let tile = 0; tile < out.length; tile++) out[tile] = kinds[tile] === 0 ? 0xfff0 : 0;
  // A sweep in each direction carries the distance one way; a cylinder needs a second round.
  for (let round = 0; round < (wrapsX ? 2 : 1); round++) {
    for (const dir of [1, -1]) {
      for (let y = dir > 0 ? 0 : height - 1; y >= 0 && y < height; y += dir) {
        for (let x = dir > 0 ? 0 : width - 1; x >= 0 && x < width; x += dir) {
          const tile = y * width + x;
          const west = wrapsX ? (x - dir + width) % width : x - dir;
          const beside = west < 0 || west >= width ? 0xfff0 : (out[y * width + west] as number);
          const above =
            y - dir < 0 || y - dir >= height ? 0xfff0 : (out[tile - dir * width] as number);
          out[tile] = Math.min(out[tile] as number, beside + 1, above + 1);
        }
      }
    }
  }
  return out;
}

/**
 * Land relief averaged over the 5 x 5 tiles around each tile, the sea counting
 * as sea level, so the land eases down toward the coast. Box sums are
 * separable: rows first, then columns, with a running sum along each line.
 */
function smoothRelief(options: TerrainColorOptions): Float32Array {
  const { width, height, kinds, relief, wrapsX } = options;
  const size = width * height;
  const radius = 2;
  const input = new Float32Array(size);
  for (let tile = 0; tile < size; tile++)
    input[tile] = kinds[tile] === 0 ? 0 : (relief[tile] as number);
  // A line starts at `first`, steps by `step`, and wraps if `wraps`, else clamps.
  const line = (
    from: Float32Array,
    to: Float32Array,
    first: number,
    step: number,
    length: number,
    wraps: boolean,
  ): void => {
    const index = (i: number): number =>
      first + step * (wraps ? (i + length) % length : Math.min(length - 1, Math.max(0, i)));
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += from[index(k)] as number;
    for (let i = 0, tile = first; i < length; i++, tile += step) {
      to[tile] = sum / (2 * radius + 1);
      sum += (from[index(i + radius + 1)] as number) - (from[index(i - radius)] as number);
    }
  };
  const rows = new Float32Array(size);
  for (let y = 0; y < height; y++) line(input, rows, y * width, 1, width, wrapsX);
  for (let x = 0; x < width; x++) line(rows, input, x, width, height, false);
  return input;
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
