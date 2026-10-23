/**
 * Binary terrain file of a map, format version 1 (docs/map-format.md).
 *
 * A 16-byte little-endian header followed by one byte per tile, row by row
 * from the northern edge, west to east.
 */

/** "FFMP" read as a little-endian 32-bit integer. */
export const MAP_MAGIC = 0x504d4646;
export const MAP_FORMAT_VERSION = 1;
export const MAP_HEADER_BYTES = 16;

/** Bit 7 of a tile byte: the tile is land. */
export const TILE_LAND = 0x80;
/** Bit 6 of a tile byte: land with at least one water neighbour. */
export const TILE_SHORE = 0x40;
/** Bits 0 to 4: elevation band on land, depth band on water. */
export const TILE_MAGNITUDE = 0x1f;
/** Magnitude of land nobody can own or cross. */
export const MAGNITUDE_IMPASSABLE = 31;
/** Bit 5 is reserved and must be zero in version 1. */
const TILE_RESERVED = 0x20;

const FLAG_WRAPS_X = 0x0001;

export interface MapFile {
  readonly width: number;
  readonly height: number;
  /** True for a cylinder that wraps east to west, false for a flat map. */
  readonly wrapsX: boolean;
  /** One byte per tile, `width * height` of them, row 0 at the north. */
  readonly tiles: Uint8Array;
}

export class MapFileError extends Error {
  override readonly name = "MapFileError";
}

export function mapFileBytes(width: number, height: number): number {
  return MAP_HEADER_BYTES + width * height;
}

export function encodeMapFile(map: MapFile): Uint8Array {
  const { width, height, wrapsX, tiles } = map;
  checkSize(width, height);
  if (tiles.length !== width * height) {
    throw new MapFileError(
      `${String(tiles.length)} tiles given for a ${String(width)}x${String(height)} map`,
    );
  }
  const bytes = new Uint8Array(mapFileBytes(width, height));
  const header = new DataView(bytes.buffer);
  header.setUint32(0, MAP_MAGIC, true);
  header.setUint16(4, MAP_FORMAT_VERSION, true);
  header.setUint16(6, wrapsX ? FLAG_WRAPS_X : 0, true);
  header.setUint32(8, width, true);
  header.setUint32(12, height, true);
  bytes.set(tiles, MAP_HEADER_BYTES);
  return bytes;
}

/** Reads a terrain file, refusing anything this version does not fully understand. */
export function decodeMapFile(bytes: Uint8Array): MapFile {
  if (bytes.length < MAP_HEADER_BYTES) {
    throw new MapFileError(`file is ${String(bytes.length)} bytes, shorter than its header`);
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, MAP_HEADER_BYTES);
  if (header.getUint32(0, true) !== MAP_MAGIC) {
    throw new MapFileError("not a Frontfall map file");
  }
  const version = header.getUint16(4, true);
  if (version !== MAP_FORMAT_VERSION) {
    throw new MapFileError(`unsupported map format version ${String(version)}`);
  }
  const flags = header.getUint16(6, true);
  if ((flags & ~FLAG_WRAPS_X) !== 0) {
    throw new MapFileError(`unknown header flags 0x${flags.toString(16)}`);
  }
  const width = header.getUint32(8, true);
  const height = header.getUint32(12, true);
  checkSize(width, height);
  if (bytes.length !== mapFileBytes(width, height)) {
    throw new MapFileError(
      `file is ${String(bytes.length)} bytes, a ${String(width)}x${String(height)} map needs ${String(mapFileBytes(width, height))}`,
    );
  }
  const tiles = bytes.subarray(MAP_HEADER_BYTES);
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i] as number;
    if ((tile & TILE_RESERVED) !== 0 || ((tile & TILE_LAND) === 0 && (tile & TILE_SHORE) !== 0)) {
      throw new MapFileError(`tile ${String(i)} has invalid bits 0x${tile.toString(16)}`);
    }
  }
  return { width, height, wrapsX: (flags & FLAG_WRAPS_X) !== 0, tiles };
}

function checkSize(width: number, height: number): void {
  // 2^26 tiles is far above any planned map and keeps every index a small integer.
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 1 << 26
  ) {
    throw new MapFileError(`invalid map size ${String(width)}x${String(height)}`);
  }
}
