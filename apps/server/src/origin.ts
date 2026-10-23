/**
 * Browsers always send Origin, so checking it stops other sites from opening
 * a game socket in a player's browser. Tools such as bots send none and are
 * let through: they could forge the header anyway. Unset accepts any origin,
 * which keeps local development simple.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: string | undefined): boolean {
  if (!allowed || origin === undefined) return true;
  return origin === allowed;
}
