/** A closed ring of [longitude, latitude] pairs, as GeoJSON stores it. */
export type Ring = readonly (readonly [number, number])[];

/** One feature's rings. Holes are rings too: filling is even-odd. */
export interface Shape {
  readonly rings: readonly Ring[];
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface Place {
  readonly lon: number;
  readonly lat: number;
  readonly properties: Readonly<Record<string, unknown>>;
}

/** Equirectangular tile grid over a longitude and latitude box. */
export interface GridSpec {
  readonly width: number;
  readonly height: number;
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
}

interface Feature {
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
}

function features(collection: unknown): Feature[] {
  const value = collection as { type?: unknown; features?: unknown };
  if (value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw new Error("expected a GeoJSON FeatureCollection");
  }
  return value.features as Feature[];
}

/** Polygons and multipolygons of a feature collection; other geometries are skipped. */
export function shapes(collection: unknown): Shape[] {
  const result: Shape[] = [];
  for (const feature of features(collection)) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const properties = feature.properties ?? {};
    if (geometry.type === "Polygon") {
      result.push({ rings: geometry.coordinates as Ring[], properties });
    } else if (geometry.type === "MultiPolygon") {
      result.push({ rings: (geometry.coordinates as Ring[][]).flat(), properties });
    }
  }
  return result;
}

/** Point features of a collection. */
export function places(collection: unknown): Place[] {
  const result: Place[] = [];
  for (const feature of features(collection)) {
    if (feature.geometry?.type !== "Point") continue;
    const [lon, lat] = feature.geometry.coordinates as [number, number];
    result.push({ lon, lat, properties: feature.properties ?? {} });
  }
  return result;
}

/** Column and row of the tile whose centre is nearest, or undefined outside the grid. */
export function tileAt(grid: GridSpec, lon: number, lat: number): number | undefined {
  const x = Math.floor(((lon - grid.west) / (grid.east - grid.west)) * grid.width);
  const y = Math.floor(((grid.north - lat) / (grid.north - grid.south)) * grid.height);
  if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) return undefined;
  return y * grid.width + x;
}

/**
 * Marks every tile whose centre lies inside the shape (even-odd rule), with
 * `value` in `out`. Tile centres sit at half-integer positions, so a point is
 * never exactly on a column or row boundary and two machines always agree:
 * the computation only uses additions, multiplications and divisions.
 *
 * Returns the tiles it marked, in row order.
 */
export function fillShape(
  grid: GridSpec,
  shape: Shape,
  out: Uint8Array,
  value: number,
  crossings: number[][] = [],
): number[] {
  const scaleX = grid.width / (grid.east - grid.west);
  const scaleY = grid.height / (grid.north - grid.south);
  let top = grid.height;
  let bottom = -1;

  for (const ring of shape.rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i] as readonly [number, number];
      const b = ring[i + 1] as readonly [number, number];
      // Grid units, with tile centres on integers.
      const ax = (a[0] - grid.west) * scaleX - 0.5;
      const ay = (grid.north - a[1]) * scaleY - 0.5;
      const bx = (b[0] - grid.west) * scaleX - 0.5;
      const by = (grid.north - b[1]) * scaleY - 0.5;
      if (ay === by) continue;
      // Rows r with min <= r < max: each crossing counted once at shared vertices.
      const [y0, x0, y1, x1] = ay < by ? [ay, ax, by, bx] : [by, bx, ay, ax];
      const first = Math.max(0, Math.ceil(y0));
      const last = Math.min(grid.height - 1, Math.ceil(y1) - 1);
      for (let row = first; row <= last; row++) {
        const x = x0 + ((row - y0) * (x1 - x0)) / (y1 - y0);
        (crossings[row] ??= []).push(x);
        if (row < top) top = row;
        if (row > bottom) bottom = row;
      }
    }
  }

  const marked: number[] = [];
  for (let row = top; row <= bottom; row++) {
    const xs = crossings[row];
    if (!xs || xs.length === 0) continue;
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil(xs[i] as number));
      const to = Math.min(grid.width - 1, Math.ceil(xs[i + 1] as number) - 1);
      for (let column = from; column <= to; column++) {
        const tile = row * grid.width + column;
        out[tile] = value;
        marked.push(tile);
      }
    }
    xs.length = 0;
  }
  return marked;
}

/** Fills every shape into a fresh mask of 0 and 1. */
export function fillShapes(grid: GridSpec, list: readonly Shape[]): Uint8Array {
  const mask = new Uint8Array(grid.width * grid.height);
  const crossings: number[][] = [];
  for (const shape of list) fillShape(grid, shape, mask, 1, crossings);
  return mask;
}
