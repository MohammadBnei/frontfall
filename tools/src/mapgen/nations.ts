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

/**
 * A start the map always has, at a place that is not a country's capital: the
 * seat of a region, such as a territory of a large country, or of a land that
 * belongs to another country. It takes the region's name when `region` is
 * set, the country's otherwise.
 */
export interface Seat {
  /** The place's Natural Earth name. */
  place: string;
  /** Its country's ADM0_A3 code. */
  country: string;
  region?: boolean;
}

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
  options: {
    count: number;
    minDistance: number;
    edgeMargin?: number;
    seats?: readonly Seat[];
  },
): Nation[] {
  const margin = options.edgeMargin ?? 0;
  const nearEdge = (tile: number): boolean => {
    const x = topology.x(tile);
    const y = topology.y(tile);
    const fromSide = topology.wrapsX ? margin : Math.min(x, topology.width - 1 - x);
    return Math.min(y, topology.height - 1 - y, fromSide) < margin;
  };
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
    if (tile === undefined || nearEdge(tile)) continue;
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
  const take = (nation: Nation): void => {
    chosen.push(nation);
    candidates.forEach((candidate, i) => {
      const distance = topology.distance(candidate.nation.tile, nation.tile);
      if (distance < (nearest[i] as number)) nearest[i] = distance;
    });
  };
  // Seats come first, in the order given, so the countries around them are
  // spaced from them like from any other nation.
  for (const seat of options.seats ?? []) {
    const nation = seatNation(grid, topology, tiles, places, seat);
    const crowded = chosen.find(
      (other) => topology.distance(other.tile, nation.tile) < options.minDistance,
    );
    if (crowded) {
      throw new Error(
        `seat ${seat.place} is closer than nations.minDistance to ${crowded.capital}`,
      );
    }
    if (nearEdge(nation.tile)) throw new Error(`seat ${seat.place} is too close to an edge`);
    take(nation);
  }
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
    take(pick.nation);
  }
  return chosen;
}

function seatNation(
  grid: GridSpec,
  topology: Topology,
  tiles: Uint8Array,
  places: readonly Place[],
  seat: Seat,
): Nation {
  const place = places.find(
    (p) => p.properties.name === seat.place && p.properties.adm0_a3 === seat.country,
  );
  if (!place) throw new Error(`seat ${seat.place} (${seat.country}) is not a Natural Earth place`);
  const at = tileAt(grid, place.lon, place.lat);
  const tile = at === undefined ? undefined : nearestOwnable(topology, tiles, at);
  if (tile === undefined) throw new Error(`seat ${seat.place} has no land a player can own nearby`);
  const name = seat.region ? place.properties.adm1name : place.properties.adm0name;
  return { name: String(name), capital: seat.place, tile };
}

/** Nearest ownable tile by grid distance, lowest index first on a tie. */
export function nearestOwnable(
  topology: Topology,
  tiles: Uint8Array,
  center: number,
): number | undefined {
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
