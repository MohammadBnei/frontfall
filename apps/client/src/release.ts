declare const __FRONTFALL_RELEASE__: string | undefined;

/** Release of the game, the client's package.json version, set by Vite. */
export const RELEASE = typeof __FRONTFALL_RELEASE__ === "string" ? __FRONTFALL_RELEASE__ : "0.0.0";

/**
 * Every release before 1.0 is a beta: rules, balance and visuals still
 * change. The badge goes away by itself when the version reaches 1.0.0.
 */
export function isBeta(release: string = RELEASE): boolean {
  const major = Number.parseInt(release, 10);
  return !(major >= 1);
}
