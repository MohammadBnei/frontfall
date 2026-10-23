/**
 * All geometry of the map goes through this interface (ADR 0002), so that
 * wrapping maps, and later the globe, need no special case anywhere else.
 * A tile is an integer in [0, size).
 */
export interface Topology {
  readonly size: number;
  readonly width: number;
  readonly height: number;
  /** Whether moving east from the last column leads to the first one. */
  readonly wrapsX: boolean;

  x(tile: number): number;
  y(tile: number): number;
  /** Tile at column x and row y. On a wrapping map any column is accepted. */
  index(x: number, y: number): number;

  /** Orthogonal neighbours, north, east, west, south, without duplicates. */
  neighbors(tile: number): readonly number[];
  /** Same tiles in the same order as neighbors(), written into `out` (length 4 or more). Returns the count. */
  neighborsInto(tile: number, out: Int32Array): number;
  /** Manhattan distance, taking the shorter way around a wrapping map. */
  distance(a: number, b: number): number;
  /** Square of the straight-line distance in tiles, the shorter way around a wrapping map. Exact integer. */
  squaredDistance(a: number, b: number): number;
  /** Every tile at a distance of `radius` or less from `center`, in row order. */
  tilesWithin(center: number, radius: number): readonly number[];
  /** Centre of a tile on an equirectangular projection, in degrees. For rendering only. */
  toLatLon(tile: number): { lat: number; lon: number };
}
