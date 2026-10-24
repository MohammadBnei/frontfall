/**
 * Balance values from docs/balance.md, converted to the units the engine uses.
 * Each field names its key in that document; change both together.
 */
export interface Balance {
  /** B-TICK-RATE */
  ticksPerSecond: number;
  /** B-SPAWN-PHASE, in ticks */
  spawnPhaseTicks: number;
  /** B-SPAWN-DISTANCE, in tiles */
  spawnDistance: number;
  /** B-SPAWN-RADIUS, in tiles */
  spawnRadius: number;
  /** B-START-TROOPS */
  startTroops: number;
  /** B-POP-PER-TILE, troops of population cap per owned tile */
  popPerTile: number;
  /** B-POP-FALLOFF-SHARE, percent of all ownable land beyond which tiles add less to the cap */
  popFalloffSharePercent: number;
  /** B-POP-FALLOFF, percent of B-POP-PER-TILE that each tile beyond that share adds */
  popFalloffPercent: number;
  /** B-POP-PER-CITY, percent of the cap the player's land gives that each working city adds */
  popPerCityPercent: number;
  /** B-GROWTH-RATE, in basis points of the gap to the cap per second (320 = 3.2 %) */
  growthBasisPoints: number;
  /** B-GOLD-RATE, in thousandths of gold per idle troop per second (5 = 0.5 per 100) */
  goldPerThousandTroops: number;
  /** B-NEUTRAL-COST, troops per plains tile of unowned land */
  neutralCost: number;
  /** B-RELIEF-COST, in tenths, for plains, hills and mountains */
  reliefCostTenths: readonly [number, number, number];
  /** B-ATTACK-SPEED: an attack takes 1 + isqrt(troops) / attackSpeedDivisor tiles per tick */
  attackSpeedDivisor: number;
  /** B-ATTACK-SPREAD, tiles of distance to the aim that each side shared with the attacker's land is worth */
  attackSpread: number;
  /** B-DEFENSE-DENSITY, in tenths: share of the defender's troops per tile added to the cost of a tile */
  defenseDensityTenths: number;
  /** B-RETREAT-PENALTY, percent of the returning troops lost */
  retreatPenaltyPercent: number;
  /** B-ENCIRCLE-MAX, largest pocket in tiles captured at once by encirclement */
  encircleMaxTiles: number;
  /** B-BOAT-SPEED, water tiles a transport ship moves per tick */
  boatSpeed: number;
  /** B-BOAT-MAX, transport ships a player may have at sea at once */
  boatMax: number;
  /** B-BOAT-RANGE, longest sea route in water tiles */
  boatRange: number;
  /** B-BUILD-TIME, in ticks from the order to the first tick a structure works */
  buildTicks: number;
  /** B-COST-CITY, gold for a player's first city */
  cityCost: number;
  /** B-COST-FORT, gold for a player's first fort */
  fortCost: number;
  /** B-COST-PORT, gold for a player's first port */
  portCost: number;
  /** B-COST-GROWTH, percent: each structure of a kind already owned multiplies the cost of the next by this */
  costGrowthPercent: number;
  /** B-BUILD-SPACING, smallest distance in tiles between two structures */
  buildSpacing: number;
  /** B-CITY-LAND, tiles of land each city beyond the first needs, on a map of 2^19 tiles */
  cityLand: number;
  /** B-FORT-RADIUS, in tiles on a map of 2^19 tiles */
  fortRadius: number;
  /** B-FORT-STRENGTH, percent of the usual price an attacker pays for a tile a fort covers */
  fortStrengthPercent: number;
  /** B-FORT-LOSSES, percent of the usual troops a defender loses with a tile a fort covers */
  fortLossPercent: number;
  /** B-TRADE-RANGE, longest trade route between two ports, in water tiles */
  tradeRange: number;
  /** B-TRADE-INTERVAL, ticks between two departures from one port */
  tradeIntervalTicks: number;
  /** B-TRADE-MAX, trade ships from one port at sea at once */
  tradeMax: number;
  /** B-TRADE-BASE, gold each side earns from a trade ship that arrives */
  tradeBase: number;
  /** B-TRADE-PER-TILE, gold each side earns on top for each water tile of the route */
  tradePerTile: number;
  /** B-ALLIANCE-REQUEST-TIMEOUT, in ticks */
  allianceRequestTicks: number;
  /** B-ALLIANCE-DURATION, in ticks */
  allianceTicks: number;
  /** B-ALLIANCE-RENEWAL, in ticks before the end of an alliance from which it can be renewed */
  allianceRenewTicks: number;
  /** B-ALLIANCE-REQUEST-COOLDOWN, in ticks from a request running out to the next one to the same player */
  allianceCooldownTicks: number;
  /** B-TRAITOR-DURATION, in ticks */
  traitorTicks: number;
  /** B-TRAITOR-DEFENSE, percent of the usual price an attacker pays for a traitor's tile */
  traitorDefensePercent: number;
  /** B-WIN-SHARE, percent of all ownable land */
  winSharePercent: number;
  /** B-MAX-DURATION, in ticks */
  maxDurationTicks: number;
}

export const DEFAULT_BALANCE: Balance = {
  ticksPerSecond: 10,
  spawnPhaseTicks: 20 * 10,
  spawnDistance: 30,
  spawnRadius: 3,
  startTroops: 2500,
  popPerTile: 40,
  popFalloffSharePercent: 20,
  popFalloffPercent: 100,
  popPerCityPercent: 5,
  growthBasisPoints: 320,
  goldPerThousandTroops: 5,
  neutralCost: 8,
  reliefCostTenths: [10, 15, 25],
  attackSpeedDivisor: 4,
  attackSpread: 4,
  defenseDensityTenths: 10,
  retreatPenaltyPercent: 25,
  encircleMaxTiles: 4000,
  boatSpeed: 2,
  boatMax: 3,
  boatRange: 1000,
  buildTicks: 5 * 10,
  cityCost: 60_000,
  fortCost: 30_000,
  portCost: 100_000,
  costGrowthPercent: 150,
  buildSpacing: 10,
  cityLand: 10_000,
  fortRadius: 25,
  fortStrengthPercent: 200,
  fortLossPercent: 50,
  tradeRange: 500,
  tradeIntervalTicks: 10 * 10,
  tradeMax: 3,
  tradeBase: 2000,
  tradePerTile: 20,
  allianceRequestTicks: 20 * 10,
  allianceTicks: 300 * 10,
  allianceRenewTicks: 60 * 10,
  allianceCooldownTicks: 30 * 10,
  traitorTicks: 30 * 10,
  traitorDefensePercent: 50,
  winSharePercent: 75,
  maxDurationTicks: 3600 * 10,
};
