export type BotDifficulty = "easy" | "normal" | "hard";

/**
 * How often and how boldly a bot acts (R-BOT-04). Values come from the Bots
 * section of docs/balance.md; each field names its key there.
 */
export interface BotParameters {
  /** B-BOT-INTERVAL, in seconds between two decisions */
  intervalSeconds: number;
  /** B-BOT-ATTACK-RATIO, in % of the troops at home sent by one order */
  attackRatioPercent: number;
  /** B-BOT-RESERVE, in % of the population cap that never leaves home */
  reservePercent: number;
  /** B-BOT-BOLDNESS: attacks a player whose troop density is at most this % of its own */
  boldnessPercent: number;
}

export const BOT_DIFFICULTIES: Readonly<Record<BotDifficulty, Readonly<BotParameters>>> = {
  easy: { intervalSeconds: 5, attackRatioPercent: 15, reservePercent: 50, boldnessPercent: 100 },
  normal: { intervalSeconds: 3, attackRatioPercent: 25, reservePercent: 40, boldnessPercent: 110 },
  hard: { intervalSeconds: 2, attackRatioPercent: 40, reservePercent: 20, boldnessPercent: 150 },
};
