export {
  captureCost,
  defenderLoss,
  installAttacks,
  troopsPerTile,
  type Attack,
} from "./attacks.ts";
export { DEFAULT_BALANCE, type Balance } from "./balance.ts";
export { installBoats, reachableCoasts, seaRoute, type Boat, type SeaRoute } from "./boats.ts";
export { createGame } from "./create-game.ts";
export {
  DiplomacyError,
  allianceOf,
  alliesOf,
  allyError,
  betrayError,
  canRenew,
  installDiplomacy,
  isAllied,
  isTraitor,
  requestBetween,
  type Alliance,
  type AllianceRequest,
  type DiplomacyEvent,
  type RequestCooldown,
} from "./diplomacy.ts";
export {
  DESYNC_REPORT_VERSION,
  DesyncReportError,
  readDesyncReport,
  recreateGame,
  replayDesyncReport,
  type DesyncReport,
  type RecordedGame,
  type ReplayResult,
} from "./desync-report.ts";
export {
  GAME_RECORD_VERSION,
  readGameRecord,
  replayGameRecord,
  type GameRecord,
} from "./game-record.ts";
export { installEconomy, populationCap } from "./economy.ts";
export {
  installBots,
  installNations,
  NATION_EXTRA_RESERVE,
  NATION_FULL_PERCENT,
  NATION_GRACE_SECONDS,
  NATION_HOLD_PERCENT,
  NATION_ODDS_PERCENT,
  NATION_THREAT_PERCENT,
  BOT_DIFFICULTIES,
  type BotDifficulty,
  type BotParameters,
} from "./bots/index.ts";
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
export { installSpawn, spawnSettings } from "./spawn.ts";
export {
  BuildError,
  StructureKind,
  cityLimit,
  fortRadius,
  fortified,
  installStructures,
  isReady,
  placementError,
  structureAt,
  structureCost,
  structureCount,
  workingCities,
  type Structure,
} from "./structures.ts";
export { Terrain, TileKind } from "./terrain.ts";
export { BoundedFloodFill } from "./territory/bounded-flood-fill.ts";
export { MAX_PLAYER_ID, NEUTRAL, TerritoryMap } from "./territory/territory-map.ts";
export type { Topology } from "./topology.ts";
export { TurnClock } from "./turn-clock.ts";
export { installVictory } from "./victory.ts";
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
