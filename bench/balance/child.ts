import { playBalanceGame, type BalanceSetup } from "./game.ts";

/** One balance game in a process of its own: the setup as JSON in, the report as one line of JSON out. */
const setup = JSON.parse(process.argv[2] ?? "{}") as BalanceSetup;
console.log(JSON.stringify(playBalanceGame(setup)));
