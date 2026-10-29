export const MAX_NAME_LENGTH = 20;

/**
 * Letters and digits of any script, plus a few separators. It starts on a
 * letter or digit: a leading accent would sit on whatever is drawn before it.
 */
const ALLOWED = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._'-]*$/u;

/**
 * Characters that draw nothing, some of them letters to Unicode, such as the
 * Hangul fillers: a name of them would be an invisible player.
 */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/u;

/**
 * More accents in a row than any language stacks on one letter, after
 * composing: the text spills over the lines around it.
 */
const STACKED_MARKS = /\p{M}{4}/u;

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
  if (!ALLOWED.test(name) || INVISIBLE.test(name) || STACKED_MARKS.test(name))
    return { ok: false, error: "the name contains characters that are not allowed" };
  if (RESERVED.has(reservedKey(name))) return { ok: false, error: "this name is reserved" };
  // A host's name shows in the public list, to everyone in the menu.
  return listable(name);
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

/**
 * Stems that are never innocent, caught inside longer words and across
 * spacing, as in "fuckers" or "f u ck".
 */
const COARSE_STEMS = ["nigg", "fagg", "fuck"];

/**
 * Stems caught only at the start of a word, as in "enculés" or "connarde",
 * where a stem inside a word would refuse innocent ones.
 */
const COARSE_PREFIXES = ["encul", "connard", "salopard"];

const STAND_INS: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
};

/** Cyrillic and Greek letters that look like Latin ones, as typed to slip past a list. */
const LOOK_ALIKES: Record<string, string> = {
  а: "a",
  в: "b",
  е: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  α: "a",
  β: "b",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  һ: "h",
  ԁ: "d",
  ӏ: "l",
  ԛ: "q",
  ԝ: "w",
  ı: "i",
};

/**
 * Letters and digits that are hard to tell apart in the game's font. Folded
 * onto one of them, so that "BiII" and "Bill" are the same name.
 */
const LOOK_ALIKE_GLYPHS: Record<string, string> = {
  "0": "o",
  "1": "l",
  i: "l",
};

/**
 * The text as it is compared: lowercase Latin letters, accents and disguises
 * removed. Compatibility forms, such as full-width letters, become plain ones.
 */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/./gu, (char) => LOOK_ALIKES[char] ?? STAND_INS[char] ?? char);
}

/**
 * Two player names that look alike are the same name: case, accents, spaces,
 * punctuation and look-alike letters of other scripts do not tell them apart.
 * Used where names must not collide, on accounts and in a game. Digits other
 * than 0 and 1 stay digits, so "Bob 2" and "Bob 3" are told apart.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/./gu, (char) => {
      const latin = LOOK_ALIKES[char] ?? char;
      return LOOK_ALIKE_GLYPHS[latin] ?? latin;
    })
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * A name as it is matched against the reserved ones: folded, digit stand-ins
 * read as letters, and "i" and "l" taken as one, as in "AdmIn" or "FrontfaII".
 */
function reservedKey(name: string): string {
  return fold(name)
    .replace(/i/gu, "l")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Names that would let a player pass for the people running the game. */
const RESERVED = new Set(
  ["admin", "administrator", "frontfall", "moderator", "mod", "server", "staff", "system"].map(
    reservedKey,
  ),
);

/** The word and its singular, roughly, for French and English plurals. */
function forms(word: string): string[] {
  return [word, word.replace(/s$/u, ""), word.replace(/(es|x)$/u, "")];
}

function hasCoarseWord(name: string): boolean {
  const words = fold(name)
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  if (words.some((word) => forms(word).some((form) => COARSE.has(form)))) return true;
  const joined = words.join("");
  // Spelled out with separators, as in "f.u.c.k" or "p u t e".
  if (words.length > 1 && words.every((word) => word.length <= 2) && COARSE.has(joined)) {
    return true;
  }
  if (words.some((word) => COARSE_PREFIXES.some((prefix) => word.startsWith(prefix)))) {
    return true;
  }
  return COARSE_STEMS.some((stem) => joined.includes(stem));
}

/** Names others see in the public list: no web address, no coarse word. */
function listable(name: string): NameResult {
  if (ADDRESS.test(name)) return { ok: false, error: "the name may not contain a web address" };
  if (hasCoarseWord(name)) {
    return { ok: false, error: "the name contains a word that is not allowed" };
  }
  return { ok: true, name };
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
  return listable(name);
}
