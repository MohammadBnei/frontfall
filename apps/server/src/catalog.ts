import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MapCatalog } from "@frontfall/protocol";

/** Most players, bots included, that each published map is balanced for. */
export type MapLimits = ReadonlyMap<string, number>;

/**
 * Reads `maps/index.json` from the built client, the maps a host may pick.
 * Without a readable catalog, as in tests or a build without maps, only the
 * default map is offered and its size is not checked.
 */
export function loadMapLimits(staticRoot: string, fallbackMap: string): MapLimits {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(staticRoot, "maps", "index.json"), "utf8"));
    const catalog = MapCatalog.parse(raw);
    return new Map(catalog.maps.map((map) => [map.id, map.players.max]));
  } catch {
    return new Map([[fallbackMap, Number.POSITIVE_INFINITY]]);
  }
}
