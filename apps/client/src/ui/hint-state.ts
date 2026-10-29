// Kept apart from hud.ts so the choice can be tested without a page.

/** Remembered once the player sent their first attack: the banner's "click land next to yours" is no longer needed. */
export const HINT_KEY = "frontfall.hint";

export function hintSeen(storage: Storage | undefined): boolean {
  try {
    return storage?.getItem(HINT_KEY) === "seen";
  } catch {
    return false;
  }
}

export function setHintSeen(storage: Storage | undefined): void {
  try {
    storage?.setItem(HINT_KEY, "seen");
  } catch {
    // Without storage the hint shows again next game.
  }
}
