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
};
