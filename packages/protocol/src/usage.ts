import * as z from "zod/mini";
import { Difficulty, Disabled, GameRules, Teams } from "./messages.ts";

/**
 * Reports a page sends to its own server so that the game can be measured
 * (docs/privacy.md). Every field is a closed set or a number the server puts
 * into a range: nothing in them names or follows a player.
 */

/** Largest report body the server reads, in bytes. */
export const MAX_USAGE_BYTES = 1024;

/** Release of the page, such as 0.5.0. */
const release = z.string().check(z.regex(/^[0-9a-z.+-]{1,32}$/));

/**
 * Random id drawn by the page for one game, never stored by the page: it lets
 * the server count a game once when the report comes twice, and take one vote
 * per game.
 */
const gameKey = z.string().check(z.regex(/^[0-9a-f]{16}$/));

export const UsageMode = z.enum(["solo", "public", "private"]);
export type UsageMode = z.infer<typeof UsageMode>;

/**
 * How the game ended for this player: `defeat` covers being wiped out before
 * the end; `left` is a return to the menu while still in the game; `closed`
 * the tab closed during it; `disconnected` an online game lost to the
 * connection or stopped by the server.
 */
export const Outcome = z.enum(["victory", "defeat", "left", "closed", "disconnected"]);
export type Outcome = z.infer<typeof Outcome>;

export const Device = z.enum(["phone", "tablet", "desktop"]);
export type Device = z.infer<typeof Device>;

/**
 * What the player used during a game, one bit each, in this order: city, fort,
 * port, silo, air defence, warship, transport boat, alliance, gift, embargo.
 * Palaces and mosques count as cities. A bit says it happened at least once.
 */
export const USED_NAMES = [
  "city",
  "fort",
  "port",
  "silo",
  "air_defense",
  "warship",
  "boat",
  "ally",
  "gift",
  "embargo",
] as const;
export type UsedName = (typeof USED_NAMES)[number];

export const GameReport = z.strictObject({
  kind: z.literal("game"),
  release,
  game: gameKey,
  mode: UsageMode,
  /** A published map's id, or `generated`. */
  map: z.string().check(z.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), z.maxLength(64)),
  teams: Teams,
  nations: z.boolean(),
  bots: z.int().check(z.minimum(0), z.maximum(1000)),
  /** Humans in the game, this player included. */
  humans: z.int().check(z.minimum(1), z.maximum(1000)),
  difficulty: Difficulty,
  disabled: Disabled,
  /** Special rules of the game (R-MODE-08); absent from reports of pages before them. */
  rules: z.optional(GameRules),
  /** Time this player spent in the game. */
  minutes: z.number().check(z.minimum(0), z.maximum(24 * 60)),
  outcome: Outcome,
  /** Seconds from the start of the game to this player's first order once play began; absent if none. */
  firstOrder: z.optional(z.number().check(z.minimum(0), z.maximum(24 * 60 * 60))),
  device: Device,
  touch: z.boolean(),
  lang: z.enum(["en", "fr"]),
  view: z.enum(["flat", "globe"]),
  /** Features used, as a bit set over USED_NAMES; absent from reports of pages before it. */
  used: z.optional(z.int().check(z.minimum(0), z.maximum((1 << USED_NAMES.length) - 1))),
  /** Share of the claimed land the player held at its largest and when the game ended, in percent. */
  peak: z.optional(z.int().check(z.minimum(0), z.maximum(100))),
  share: z.optional(z.int().check(z.minimum(0), z.maximum(100))),
  /** Median time the map took to draw a frame, in milliseconds; absent when it was not measured. */
  frameMs: z.optional(z.number().check(z.minimum(0), z.maximum(1000))),
});
export type GameReport = z.infer<typeof GameReport>;

export const ClientErrorType = z.enum([
  "exception",
  "rejection",
  "worker",
  "webgl",
  "context_lost",
  "desync",
  "snapshot",
]);
export type ClientErrorType = z.infer<typeof ClientErrorType>;

/** Family of the browser's engine, to tell an error of one browser from one of all. */
export const BrowserFamily = z.enum(["chromium", "firefox", "safari", "other"]);
export type BrowserFamily = z.infer<typeof BrowserFamily>;

/** Where the page was when the error came: the menu, a lobby, a game or a replay. */
export const ErrorScreen = z.enum(["menu", "lobby", "solo", "online", "replay"]);
export type ErrorScreen = z.infer<typeof ErrorScreen>;

/** Which kind of code an error came from when it was not the game's own. */
export const ErrorOrigin = z.enum(["hidden", "extension", "foreign"]);
export type ErrorOrigin = z.infer<typeof ErrorOrigin>;

export const ErrorReport = z.strictObject({
  kind: z.literal("error"),
  release,
  type: ClientErrorType,
  /** Only for an error in the game's own code, already shortened by the page. */
  message: z.optional(z.string().check(z.maxLength(120))),
  /**
   * Only for an error in the game's own code: the file of the game it came
   * from, without its address, then line and column, as `main-Ab12.js:1:2045`.
   */
  where: z.optional(z.string().check(z.regex(/^[\w.-]{1,80}:\d{1,7}:\d{1,7}$/))),
  /**
   * Only for an error that does not come from the game's own code, and
   * nothing more than which kind: a script the browser hides (`hidden`), a
   * browser extension (`extension`), or a script of another address
   * (`foreign`). No address, no message.
   */
  from: z.optional(ErrorOrigin),
  browser: z.optional(BrowserFamily),
  device: z.optional(Device),
  screen: z.optional(ErrorScreen),
});
export type ErrorReport = z.infer<typeof ErrorReport>;

/** What a player who gives a thumbs down can add, and nothing else. */
export const FeedbackReason = z.enum(["too_hard", "too_long", "unclear", "slow_or_buggy"]);
export type FeedbackReason = z.infer<typeof FeedbackReason>;

export const FeedbackReport = z
  .strictObject({
    kind: z.literal("feedback"),
    release,
    game: gameKey,
    mode: UsageMode,
    outcome: Outcome,
    vote: z.enum(["up", "down"]),
    reason: z.optional(FeedbackReason),
  })
  .check(
    z.refine((report) => report.reason === undefined || report.vote === "down", {
      message: "a reason goes with a thumbs down only",
    }),
  );
export type FeedbackReport = z.infer<typeof FeedbackReport>;

export const UsageReport = z.union([GameReport, ErrorReport, FeedbackReport]);
export type UsageReport = z.infer<typeof UsageReport>;

export type ParsedUsage = { ok: true; value: UsageReport } | { ok: false; error: string };

/** Reads a report sent as JSON text. */
export function parseUsageReport(text: string): ParsedUsage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "not JSON" };
  }
  const parsed = UsageReport.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: parsed.error.issues[0]?.message ?? "invalid report" };
}
