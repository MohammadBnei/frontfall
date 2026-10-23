import type { Game } from "./game.ts";

export interface Victory {
  /** Id of the winner once the game is decided, undefined until then. */
  winner(): number | undefined;
  /** Tick at which the game was decided. */
  decidedAt(): number | undefined;
}

/**
 * Victory conditions of free-for-all (R-WIN-01, R-WIN-02). The game is decided
 * once; later ticks may keep running for spectators (R-WIN-03) but the winner
 * does not change.
 */
export function installVictory(game: Game): Victory {
  const { terrain, territory, balance } = game;
  let ownable = 0;
  for (let tile = 0; tile < terrain.topology.size; tile++) if (terrain.isOwnable(tile)) ownable++;
  const contested = game.players().length > 1;
  let winner: number | undefined;
  let decidedAt: number | undefined;

  game.onTick(() => {
    if (winner !== undefined || game.phase !== "play") return;
    const alive = game.players().filter((player) => player.alive);
    const leader = alive.reduce<(typeof alive)[number] | undefined>(
      (best, player) =>
        !best || territory.tileCount(player.id) > territory.tileCount(best.id) ? player : best,
      undefined,
    );
    if (!leader) return;
    const lastStanding = contested && alive.length === 1;
    const dominant = territory.tileCount(leader.id) * 100 >= ownable * balance.winSharePercent;
    const timeUp = game.tick + 1 >= balance.maxDurationTicks;
    if (lastStanding || dominant || timeUp) {
      winner = leader.id;
      decidedAt = game.tick;
    }
  });

  return { winner: () => winner, decidedAt: () => decidedAt };
}
