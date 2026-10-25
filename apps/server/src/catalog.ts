import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MapCatalog } from "@frontfall/protocol";

/** Bots a lone player of a quick game gets on a map the catalog does not describe. */
const FALLBACK_BOTS = 8;

/** Bots the menu suggests at most, as names run out beyond. */
const MAX_DEFAULT_BOTS = 24;

/**
 * For each published map: most players, bots included, it is balanced for,
 * and the bots a game on it gets by default, as the menu suggests them.
 */
export type MapLimits = ReadonlyMap<string, { max: number; bots: number }>;

/**
 * Reads `maps/index.json` from the built client, the maps a host may pick.
 * Without a readable catalog, as in tests or a build without maps, only the
 * default map is offered and its size is not checked.
 */
export function loadMapLimits(staticRoot: string, fallbackMap: string): MapLimits {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(staticRoot, "maps", "index.json"), "utf8"));
    const catalog = MapCatalog.parse(raw);
    return new Map(
      catalog.maps.map((map) => [
        map.id,
        {
          max: map.players.max,
          bots: Math.min(MAX_DEFAULT_BOTS, Math.max(1, map.players.recommended - 1)),
        },
      ]),
    );
  } catch {
    return new Map([[fallbackMap, { max: Number.POSITIVE_INFINITY, bots: FALLBACK_BOTS }]]);
  }
}
