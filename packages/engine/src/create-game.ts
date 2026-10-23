import { installAttacks, type Attacks } from "./attacks.ts";
import { installEconomy } from "./economy.ts";
import { Game, type GameSetup } from "./game.ts";
import { installSpawn } from "./spawn.ts";
import { installVictory, type Victory } from "./victory.ts";

export interface CreatedGame {
  game: Game;
  /** Start tile of each player, by id, once picked or placed. */
  starts: ReadonlyMap<number, number>;
  attacks: Attacks;
  victory: Victory;
}

/**
 * A game with every rule of the engine installed, in the order the rules
 * expect: orders and spawns, then attacks, then growth, then victory.
 */
export function createGame(setup: GameSetup): CreatedGame {
  const game = new Game(setup);
  const starts = installSpawn(game);
  const attacks = installAttacks(game);
  installEconomy(game);
  const victory = installVictory(game);
  return { game, starts, attacks, victory };
}
