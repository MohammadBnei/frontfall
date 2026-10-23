export { installAttacks, type Attack, type Attacks } from "./attacks.ts";
export { DEFAULT_BALANCE, type Balance } from "./balance.ts";
export { createGame, type CreatedGame } from "./create-game.ts";
export { installEconomy, populationCap } from "./economy.ts";
export {
  Game,
  type GameSetup,
  type Order,
  type OrderHandler,
  type Phase,
  type Player,
  type PlayerSetup,
  type TickSystem,
  type Turn,
} from "./game.ts";
export { clamp, divFloor, isqrt, mulDiv, percentOf } from "./integer-math.ts";
export { orderError } from "./orders.ts";
export { Random, type RandomState } from "./random.ts";
export { installSpawn } from "./spawn.ts";
export { Terrain, TileKind } from "./terrain.ts";
export { BoundedFloodFill } from "./territory/bounded-flood-fill.ts";
export { MAX_PLAYER_ID, NEUTRAL, TerritoryMap } from "./territory/territory-map.ts";
export type { Topology } from "./topology.ts";
export { installVictory, type Victory } from "./victory.ts";
export { WorldGrid, type WorldGridOptions } from "./world-grid.ts";
export {
  HILLS_FROM,
  MOUNTAINS_FROM,
  loadMap,
  type LoadedMap,
  type MapDescription,
} from "./map/load-map.ts";
export {
  MAGNITUDE_IMPASSABLE,
  MAP_FORMAT_VERSION,
  MAP_HEADER_BYTES,
  MapFileError,
  TILE_LAND,
  TILE_MAGNITUDE,
  TILE_SHORE,
  decodeMapFile,
  encodeMapFile,
  mapFileBytes,
  type MapFile,
} from "./map/map-file.ts";
export { sha256Hex } from "./map/sha256.ts";
