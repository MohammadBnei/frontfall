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
