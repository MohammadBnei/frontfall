import type { Game } from "./game.ts";

/**
 * Victory conditions (R-WIN-01, R-WIN-02; R-MODE-02 for teams), recorded in
 * `game.winner`, `game.winningTeam` and `game.decidedAt`. The game is decided
 * once; later ticks may keep running for spectators (R-WIN-03) but the winner
 * does not change. In a team game, teammates' land counts together towards
 * B-WIN-SHARE, and the winner is the winning team's member with the most land.
 */
export function installVictory(game: Game): void {
  const { terrain, territory, balance } = game;
  const ownable = terrain.ownableCount;
  const contested = game.players().length > 1;
  const teams = game.teams;
  const share = balance.winSharePercent;
  // Land per side: per player in a free-for-all, per team otherwise.
  const land = new Array<number>(teams + 1).fill(0);

  game.onTick(() => {
    if (game.winner !== undefined || game.phase !== "play") return;
    land.fill(0);
    const sides = new Set<number>();
    let leader: number | undefined;
    for (const player of game.players()) {
      if (!player.alive) continue;
      sides.add(teams === 0 ? player.id : player.team);
      if (teams > 0) land[player.team] = (land[player.team] ?? 0) + territory.tileCount(player.id);
    }
    // The side with the most land; on a tie, the one of the lowest player id.
    let best = -1;
    for (const player of game.players()) {
      if (!player.alive) continue;
      const held = teams === 0 ? territory.tileCount(player.id) : (land[player.team] as number);
      if (held > best) {
        best = held;
        leader = player.id;
      }
    }
    if (leader === undefined) return;
    const lastStanding = contested && sides.size === 1;
    const dominant = best * 100 >= ownable * share;
    const timeUp = game.tick + 1 >= balance.maxDurationTicks;
    if (!(lastStanding || dominant || timeUp)) return;
    if (teams > 0) {
      const team = game.player(leader)?.team ?? 0;
      game.winningTeam = team;
      // The team's member with the most land, the lowest id on a tie.
      let top = -1;
      for (const player of game.players()) {
        if (player.team !== team || !player.alive) continue;
        const held = territory.tileCount(player.id);
        if (held > top) {
          top = held;
          leader = player.id;
        }
      }
    }
    game.winner = leader;
    game.decidedAt = game.tick;
  });
}
