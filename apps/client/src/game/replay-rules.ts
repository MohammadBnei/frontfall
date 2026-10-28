/** Extension of a saved replay: a game record in JSON, compressed with gzip. */
export const REPLAY_EXTENSION = ".ffr";

/** Paces a replay can run at, in ticks per tick of time. */
export const REPLAY_SPEEDS = [1, 2, 4, 8] as const;

/** Error of a replay whose map is no longer the one it was played on. */
export const REPLAY_MAP_CHANGED = "the map of the replay has changed since";

/**
 * Whether a replay's map is the one loaded now. The terrain's hash alone is
 * not enough: a new version can keep the terrain and change the nations, and
 * a replay played with other nations would not reach the same state.
 */
export function sameReplayMap(
  recorded: { readonly version: number; readonly sha256: string },
  loaded: { readonly version: number; readonly sha256: string } | undefined,
): boolean {
  return recorded.sha256 === loaded?.sha256 && recorded.version === loaded.version;
}
