import { installAttacks } from "./attacks.ts";
import { installBoats } from "./boats.ts";
import { installDiplomacy } from "./diplomacy.ts";
import { installEconomy } from "./economy.ts";
import { Game, type GameSetup } from "./game.ts";
import { installSpawn } from "./spawn.ts";
import { installStructures } from "./structures.ts";
import { installVictory } from "./victory.ts";

/**
 * A game with every rule of the engine installed, in the order the rules
 * expect: spawns, then alliances, then attacks, then ships, then structures changing hands
 * with their tiles, then growth, then victory. Order handlers and
 * tick systems run in registration order, so this order is part of the game.
 */
export function createGame(setup: GameSetup): Game {
  const game = new Game(setup);
  installSpawn(game);
  installDiplomacy(game);
  installAttacks(game);
  installBoats(game);
  installStructures(game);
  installEconomy(game);
  installVictory(game);
  return game;
}
