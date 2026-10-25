import type { GameOptions } from "@frontfall/protocol";

/** How long the host's own choices hold against the server's, without an answer to them. */
export const EDIT_PATIENCE_MS = 3_000;

/**
 * The settings the host of a private game sent last, until the server's
 * lobby shows them back. Every change goes to the server and comes back in
 * the next lobby, but a lobby sent before a change can arrive after it:
 * written into the controls, it would undo the change, and the next one
 * would carry the old value to the server. So the controls keep the host's
 * choices until a lobby shows them, or for `patienceMs` at most, for a
 * server that changed them (fewer bots once more players joined).
 */
export class PendingEdits {
  private sent: GameOptions | undefined;
  private since = 0;

  constructor(private readonly patienceMs = EDIT_PATIENCE_MS) {}

  /** The host sent these settings at `now`. */
  send(options: GameOptions, now: number): void {
    this.sent = options;
    this.since = now;
  }

  /** Whether a lobby with these settings may be written into the host's controls. */
  accepts(lobby: GameOptions, now: number): boolean {
    if (this.sent && !same(lobby, this.sent) && now - this.since < this.patienceMs) return false;
    this.sent = undefined;
    return true;
  }

  /** Whether the host's choices waited out their patience without an answer. */
  expired(now: number): boolean {
    return this.sent !== undefined && now - this.since >= this.patienceMs;
  }
}

function same(a: GameOptions, b: GameOptions): boolean {
  return (
    a.map === b.map &&
    a.bots === b.bots &&
    a.difficulty === b.difficulty &&
    a.nations === b.nations &&
    a.teams === b.teams &&
    a.disabled === b.disabled
  );
}
