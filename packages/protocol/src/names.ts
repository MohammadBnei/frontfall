export const MAX_NAME_LENGTH = 20;

/** Letters and digits of any script, plus a few separators. */
const ALLOWED = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} ._'-]*$/u;

/** Names that would let a player pass for the people running the game. */
const RESERVED = new Set([
  "admin",
  "administrator",
  "frontfall",
  "moderator",
  "mod",
  "server",
  "staff",
  "system",
]);

export type NameResult = { ok: true; name: string } | { ok: false; error: string };

/**
 * Cleans a player name: Unicode NFC, trimmed, runs of spaces collapsed. The
 * same function runs in the client, to warn early, and in the server, which
 * has the final say.
 */
export function normalizeName(raw: string): NameResult {
  const name = raw.normalize("NFC").trim().replace(/\s+/gu, " ");
  // Counted in code points, after NFC: an accented letter counts once.
  const length = Array.from(name).length;
  if (length === 0) return { ok: false, error: "the name is empty" };
  if (length > MAX_NAME_LENGTH) {
    return { ok: false, error: `the name is longer than ${String(MAX_NAME_LENGTH)} characters` };
  }
  if (!ALLOWED.test(name))
    return { ok: false, error: "the name contains characters that are not allowed" };
  const bare = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (RESERVED.has(bare)) return { ok: false, error: "this name is reserved" };
  return { ok: true, name };
}

export const MIN_GAME_NAME_LENGTH = 3;
export const MAX_GAME_NAME_LENGTH = 32;

/** Game names take a little more punctuation than player names. */
const GAME_NAME_ALLOWED = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} ._'!?#&()+:,-]*$/u;

/** A web address in a listed name would turn the public list into an advert board. */
const ADDRESS = /:\/\/|www\.|\.(com|net|org|fr|io|gg|co|xyz|me|tv|ly|be|de|eu|ru|info|app)\b/iu;

/**
 * Words a public game name may not contain, French and English, compared
 * whole after folding accents and common digit stand-ins. Short on purpose:
 * it catches the obvious, and a player can always be reported.
 */
const COARSE = new Set([
  // English
  "asshole",
  "bastard",
  "bitch",
  "cock",
  "cunt",
  "dick",
  "fag",
  "faggot",
  "fuck",
  "fucker",
  "fucking",
  "hitler",
  "nazi",
  "nigga",
  "nigger",
  "porn",
  "pussy",
  "rape",
  "retard",
  "shit",
  "slut",
  "whore",
  // French
  "batard",
  "bougnoule",
  "connard",
  "connasse",
  "couille",
  "couilles",
  "encule",
  "enculer",
  "fdp",
  "negre",
  "nique",
  "niquer",
  "pd",
  "pede",
  "pedale",
  "pute",
  "putain",
  "salope",
  "tapette",
  "viol",
]);

const STAND_INS: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
};

function hasCoarseWord(name: string): boolean {
  const folded = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[013457]/g, (digit) => STAND_INS[digit] ?? digit);
  const words = folded.split(/[^\p{L}]+/u).filter(Boolean);
  // Spelled out with separators, as in "f.u.c.k" or "p u t e".
  const joined = words.every((word) => word.length === 1) ? [words.join("")] : [];
  return [...words, ...joined].some((word) => COARSE.has(word));
}

/**
 * Cleans the name of a public game the way `normalizeName` cleans a player's,
 * then turns away web addresses and coarse words. The client checks early,
 * the server has the final say.
 */
export function normalizeGameName(raw: string): NameResult {
  const name = raw.normalize("NFC").trim().replace(/\s+/gu, " ");
  const length = Array.from(name).length;
  if (length < MIN_GAME_NAME_LENGTH) {
    return {
      ok: false,
      error: `the name is shorter than ${String(MIN_GAME_NAME_LENGTH)} characters`,
    };
  }
  if (length > MAX_GAME_NAME_LENGTH) {
    return {
      ok: false,
      error: `the name is longer than ${String(MAX_GAME_NAME_LENGTH)} characters`,
    };
  }
  if (!GAME_NAME_ALLOWED.test(name)) {
    return { ok: false, error: "the name contains characters that are not allowed" };
  }
  if (ADDRESS.test(name)) return { ok: false, error: "the name may not contain a web address" };
  if (hasCoarseWord(name))
    return { ok: false, error: "the name contains a word that is not allowed" };
  return { ok: true, name };
}
