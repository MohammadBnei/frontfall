import type { Game } from "./game.ts";

/**
 * Victory conditions of free-for-all (R-WIN-01, R-WIN-02), recorded in
 * `game.winner` and `game.decidedAt`. The game is decided once; later ticks
 * may keep running for spectators (R-WIN-03) but the winner does not change.
 */
export function installVictory(game: Game): void {
  const { terrain, territory, balance } = game;
  const ownable = terrain.ownableCount;
  const contested = game.players().length > 1;

  game.onTick(() => {
    if (game.winner !== undefined || game.phase !== "play") return;
    let leader: number | undefined;
    let alive = 0;
    for (const player of game.players()) {
      if (!player.alive) continue;
      alive++;
      if (leader === undefined || territory.tileCount(player.id) > territory.tileCount(leader)) {
        leader = player.id;
      }
    }
    if (leader === undefined) return;
    const lastStanding = contested && alive === 1;
    const dominant = territory.tileCount(leader) * 100 >= ownable * balance.winSharePercent;
    const timeUp = game.tick + 1 >= balance.maxDurationTicks;
    if (lastStanding || dominant || timeUp) {
      game.winner = leader;
      game.decidedAt = game.tick;
    }
  });
}
