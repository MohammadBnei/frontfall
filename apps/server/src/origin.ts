/**
 * Browsers always send Origin, so checking it stops other sites from opening
 * a game socket in a player's browser. Tools such as bots send none and are
 * let through: they could forge the header anyway. Unset accepts any origin,
 * which keeps local development simple. `allowed` may list several origins,
 * separated by commas, such as a site and its `www.` twin.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: string | undefined): boolean {
  const list = (allowed ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (list.length === 0 || origin === undefined) return true;
  return list.includes(origin);
}
