import type { Topology } from "@frontfall/engine";
import { TILE_LAND, TILE_MAGNITUDE, MAGNITUDE_IMPASSABLE } from "@frontfall/engine";
import { tileAt, type GridSpec, type Place } from "./geometry.ts";

/** What the score of a country is made of. */
export interface Country {
  population: number;
  /** Tiles of the map inside the country that a player can own. */
  land: number;
}

export interface Nation {
  name: string;
  capital: string;
  tile: number;
}

/** How far from its capital, in tiles, a nation may start when the capital is not on usable land. */
const SNAP_RADIUS = 12;

const isOwnable = (tile: number): boolean =>
  (tile & TILE_LAND) !== 0 && (tile & TILE_MAGNITUDE) !== MAGNITUDE_IMPASSABLE;

/** Distance, in multiples of `minDistance`, beyond which being far from other nations stops counting. */
const SPREAD = 3;

/**
 * Computer-controlled nations from Natural Earth: one per country, starting on
 * the land tile a player can own nearest to its capital.
 *
 * Nations are chosen one at a time. Each pick goes to the country with the
 * best score: the fourth root of its population times its playable land on
 * this map, times its distance to the nations already chosen (capped at
 * `SPREAD` times `minDistance`). No two nations start closer than
 * `minDistance`. Large and populous countries come first, but a crowded
 * region cannot take every seat: once a few nations stand in it, a smaller
 * country on an empty coast outranks the next large one nearby.
 *
 * The result is in pick order, so taking the first n nations of a manifest
 * still spreads them over the map.
 */
export function pickNations(
  grid: GridSpec,
  topology: Topology,
  tiles: Uint8Array,
  places: readonly Place[],
  countries: ReadonlyMap<string, Country>,
  options: { count: number; minDistance: number },
): Nation[] {
  // One capital per country, the most populous when a country lists several.
  const byCountry = new Map<string, { nation: Nation; weight: number; cityPopulation: number }>();
  for (const place of places) {
    if (place.properties.adm0cap !== 1) continue;
    const code = String(place.properties.adm0_a3);
    const country = countries.get(code);
    if (!country || country.population <= 0 || country.land <= 0) continue;
    const cityPopulation = Number(place.properties.pop_max);
    const previous = byCountry.get(code);
    if (previous && previous.cityPopulation >= cityPopulation) continue;
    const at = tileAt(grid, place.lon, place.lat);
    if (at === undefined) continue;
    const tile = nearestOwnable(topology, tiles, at);
    if (tile === undefined) continue;
    byCountry.set(code, {
      nation: {
        name: String(place.properties.adm0name),
        capital: String(place.properties.name),
        tile,
      },
      weight: Math.sqrt(Math.sqrt(country.population * country.land)),
      cityPopulation,
    });
  }
  const candidates = [...byCountry.values()].sort((a, b) => compare(a.nation.name, b.nation.name));

  const spread = SPREAD * options.minDistance;
  const chosen: Nation[] = [];
  const nearest = candidates.map(() => spread);
  while (chosen.length < options.count) {
    let best = -1;
    let bestScore = 0;
    candidates.forEach((candidate, i) => {
      const distance = nearest[i] as number;
      if (distance < options.minDistance) return;
      const score = candidate.weight * distance;
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    const pick = candidates[best];
    if (!pick) break;
    chosen.push(pick.nation);
    candidates.forEach((candidate, i) => {
      const distance = topology.distance(candidate.nation.tile, pick.nation.tile);
      if (distance < (nearest[i] as number)) nearest[i] = distance;
    });
  }
  return chosen;
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
