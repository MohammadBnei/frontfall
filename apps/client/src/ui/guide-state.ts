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

/** The tutorial's chapters the player went through, as a comma-separated list. */
export const CHAPTERS_KEY = "frontfall.chapters";

export function chaptersDone(storage: Storage | undefined): readonly string[] {
  try {
    return (storage?.getItem(CHAPTERS_KEY) ?? "").split(",").filter(Boolean);
  } catch {
    return [];
  }
}

export function markChapter(storage: Storage | undefined, chapter: string): void {
  try {
    const done = new Set(chaptersDone(storage));
    done.add(chapter);
    storage?.setItem(CHAPTERS_KEY, [...done].join(","));
  } catch {
    // Without storage the chapter simply shows as new next time.
  }
}

/** The hints already shown, as a comma-separated list, or `off` once the player turned them away. */
export const HINTS_KEY = "frontfall.hints";

export function hintsSeen(storage: Storage | undefined): readonly string[] {
  try {
    return (storage?.getItem(HINTS_KEY) ?? "").split(",").filter(Boolean);
  } catch {
    return [];
  }
}

export function markHint(storage: Storage | undefined, hint: string): void {
  try {
    const seen = hintsSeen(storage);
    if (seen.includes(hint) || seen.includes("off")) return;
    storage?.setItem(HINTS_KEY, [...seen, hint].join(","));
  } catch {
    // Without storage a hint can show again next game.
  }
}

export function turnHintsOff(storage: Storage | undefined): void {
  try {
    storage?.setItem(HINTS_KEY, "off");
  } catch {
    // Without storage the tips come back next game.
  }
}
