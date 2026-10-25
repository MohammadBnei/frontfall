import {
  DEFAULT_BALANCE,
  createGame,
  installBots,
  installNations,
  type Balance,
  type Game,
  type GameSetup,
  type PlayerSetup,
} from "@frontfall/engine";
import type { Difficulty, SoloOptions } from "./solo-game.ts";

/**
 * How this client sets up the simulation of a game from its options: who
 * plays with which id, the balance, and the rules installed. Every client of
 * an online game must do it alike, so this file is part of the simulation
 * build (docs/protocol.md, "Simulation build"), with the engine and the
 * protocol; keep anything else out of it.
 */

export const HUMAN_ID = 1;

/** Options that decide the setup, and only those. */
export type SetupOptions = Pick<
  SoloOptions,
  "bots" | "players" | "playerName" | "nations" | "maxMinutes" | "goldRate" | "cityLand"
>;

/** Names for computer players. Invented, so they never collide with real countries. */
const BOT_NAMES = [
  "Aldmere",
  "Brask",
  "Corvan",
  "Dunmoor",
  "Elsk",
  "Fenwold",
  "Gorran",
  "Halvik",
  "Istra",
  "Jorvel",
  "Kesh",
  "Lorne",
  "Mirava",
  "Norrin",
  "Ostmark",
  "Pellan",
  "Quill",
  "Ravenna",
  "Sorrel",
  "Tarsk",
  "Ulvar",
  "Vesk",
  "Wyndham",
  "Yarrow",
  "Zennor",
];

export const MAX_BOTS = BOT_NAMES.length;

/** Players and balance of a new game: the humans, then the bots, then the map's nations. */
export function newSetup(
  options: SetupOptions,
  mapNations: readonly { name: string; tile: number }[],
): { players: PlayerSetup[]; botIds: number[]; nationIds: number[]; balance: Balance } {
  const bots = Math.max(0, Math.min(MAX_BOTS, Math.floor(options.bots)));
  const humans = options.players ?? [{ id: HUMAN_ID, name: options.playerName }];
  const firstBot = Math.max(...humans.map((human) => human.id)) + 1;
  const players: PlayerSetup[] = [...humans];
  const botIds: number[] = [];
  for (let i = 0; i < bots; i++) {
    botIds.push(firstBot + i);
    players.push({ id: firstBot + i, name: BOT_NAMES[i] as string });
  }
  // Nations take the numbers after the bots, in the manifest's order, the same on every client.
  const nationIds: number[] = [];
  if (options.nations) {
    for (const { name, tile } of mapNations) {
      const id = firstBot + bots + nationIds.length;
      nationIds.push(id);
      players.push({ id, name, start: tile });
    }
  }
  const balance = { ...DEFAULT_BALANCE };
  if (options.maxMinutes !== undefined) {
    balance.maxDurationTicks = Math.round(options.maxMinutes * 60 * DEFAULT_BALANCE.ticksPerSecond);
  }
  if (options.goldRate !== undefined) balance.goldPerThousandTroops = Math.floor(options.goldRate);
  if (options.cityLand !== undefined) balance.cityLand = Math.floor(options.cityLand);
  return { players, botIds, nationIds, balance };
}

/** A game with every rule installed, then the bots and the nations, in that order. */
export function createSimulation(
  setup: GameSetup,
  botIds: readonly number[],
  nationIds: readonly number[],
  difficulty: Difficulty,
): Game {
  const game = createGame(setup);
  installBots(game, botIds, difficulty);
  installNations(game, nationIds, difficulty);
  return game;
}
