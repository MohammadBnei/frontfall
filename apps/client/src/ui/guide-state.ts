// Kept apart from guide.ts, which loads only when the guide shows.

/** Remembered once the player is through the guide or hid it; read with care, storage may throw. */
export const GUIDE_KEY = "frontfall.guide";

export function guideDone(storage: Storage | undefined): boolean {
  try {
    return storage?.getItem(GUIDE_KEY) === "done";
  } catch {
    return false;
  }
}

export function setGuideDone(storage: Storage | undefined, done: boolean): void {
  try {
    if (done) storage?.setItem(GUIDE_KEY, "done");
    else storage?.removeItem(GUIDE_KEY);
  } catch {
    // Without storage the guide simply shows again next game.
  }
}
