import type { Topology } from "@frontfall/engine";
import { TILE_LAND, TILE_MAGNITUDE, MAGNITUDE_IMPASSABLE } from "@frontfall/engine";
import { tileAt, type GridSpec, type Place } from "./geometry.ts";

export interface Nation {
  name: string;
  capital: string;
  tile: number;
}

/** How far from its capital, in tiles, a nation may start when the capital is not on usable land. */
const SNAP_RADIUS = 12;

const isOwnable = (tile: number): boolean =>
  (tile & TILE_LAND) !== 0 && (tile & TILE_MAGNITUDE) !== MAGNITUDE_IMPASSABLE;

/**
 * Computer-controlled nations from Natural Earth capitals: the most populous
 * capitals first, one per country, each moved to the nearest land tile a
 * player can own, and kept at least `minDistance` tiles from the others.
 */
export function pickNations(
  grid: GridSpec,
  topology: Topology,
  tiles: Uint8Array,
  places: readonly Place[],
  options: { count: number; minDistance: number },
): Nation[] {
  const capitals = places
    .filter((place) => place.properties.adm0cap === 1)
    .map((place) => ({
      place,
      country: String(place.properties.adm0name),
      city: String(place.properties.name),
      population: Number(place.properties.pop_max),
    }))
    .sort(
      (a, b) =>
        b.population - a.population || compare(a.country, b.country) || compare(a.city, b.city),
    );

  const nations: Nation[] = [];
  const countries = new Set<string>();
  for (const { place, country, city } of capitals) {
    if (nations.length >= options.count) break;
    if (countries.has(country)) continue;
    const at = tileAt(grid, place.lon, place.lat);
    if (at === undefined) continue;
    const tile = nearestOwnable(topology, tiles, at);
    if (tile === undefined) continue;
    if (nations.some((other) => topology.distance(other.tile, tile) < options.minDistance))
      continue;
    countries.add(country);
    nations.push({ name: country, capital: city, tile });
  }
  return nations;
}

/** Nearest ownable tile by grid distance, lowest index first on a tie. */
function nearestOwnable(topology: Topology, tiles: Uint8Array, center: number): number | undefined {
  if (isOwnable(tiles[center] as number)) return center;
  for (let radius = 1; radius <= SNAP_RADIUS; radius++) {
    const ring = topology
      .tilesWithin(center, radius)
      .filter(
        (tile) => topology.distance(center, tile) === radius && isOwnable(tiles[tile] as number),
      );
    if (ring.length > 0) return Math.min(...ring);
  }
  return undefined;
}

/** Code-point order, the same on every machine and locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
