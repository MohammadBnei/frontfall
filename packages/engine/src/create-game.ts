import { installAttacks } from "./attacks.ts";
import { installBoats } from "./boats.ts";
import { installEconomy } from "./economy.ts";
import { Game, type GameSetup } from "./game.ts";
import { installSpawn } from "./spawn.ts";
import { installVictory } from "./victory.ts";

/**
 * A game with every rule of the engine installed, in the order the rules
 * expect: spawns, then attacks, then ships, then growth, then victory. Order handlers and
 * tick systems run in registration order, so this order is part of the game.
 */
export function createGame(setup: GameSetup): Game {
  const game = new Game(setup);
  installSpawn(game);
  installAttacks(game);
  installBoats(game);
  installEconomy(game);
  installVictory(game);
  return game;
}
