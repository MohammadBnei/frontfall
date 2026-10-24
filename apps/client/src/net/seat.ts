/**
 * The seat of this tab in a running online game, so a reload takes it back
 * instead of leaving the game: session storage lives as long as the tab.
 */
const KEY = "frontfall.seat";

interface Seat {
  game: string;
  token: string;
}

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function saveSeat(game: string, token: string): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ game, token } satisfies Seat));
  } catch {
    // Storage full or blocked: a reload will join from the link instead.
  }
}

/** The token of this tab's seat in `game`, if it holds one. */
export function seatIn(game: string): string | undefined {
  try {
    const seat = JSON.parse(storage()?.getItem(KEY) ?? "null") as Partial<Seat> | null;
    return seat?.game === game && typeof seat.token === "string" ? seat.token : undefined;
  } catch {
    return undefined;
  }
}

export function forgetSeat(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
