/**
 * Balance values from docs/balance.md, converted to the units the engine uses.
 * Each field names its key in that document; change both together.
 */
export interface Balance {
  /** B-TICK-RATE */
  ticksPerSecond: number;
  /** B-SPAWN-PHASE, in ticks */
  spawnPhaseTicks: number;
}

export const DEFAULT_BALANCE: Balance = {
  ticksPerSecond: 10,
  spawnPhaseTicks: 20 * 10,
};
