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
  /** B-POP-PER-CITY */
  popPerCity: number;
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
  popPerCity: 25_000,
  growthBasisPoints: 320,
  goldPerThousandTroops: 5,
  neutralCost: 8,
  reliefCostTenths: [10, 15, 25],
  attackSpeedDivisor: 8,
  defenseDensityTenths: 10,
  retreatPenaltyPercent: 25,
  encircleMaxTiles: 4000,
  boatSpeed: 2,
  boatMax: 3,
  boatRange: 1000,
  winSharePercent: 75,
  maxDurationTicks: 3600 * 10,
};
