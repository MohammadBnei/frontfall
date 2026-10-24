import { readFileSync, writeFileSync } from "node:fs";
import {
  createGame,
  DEFAULT_BALANCE,
  DESYNC_REPORT_VERSION,
  installBots,
  loadMap,
  orderError,
  reachableCoasts,
  StructureKind,
  type BotDifficulty,
  type DesyncReport,
  type MapDescription,
  type Order,
  type Turn,
} from "@frontfall/engine";
import { PROTOCOL_VERSION } from "@frontfall/protocol";

/**
 * `pnpm golden`: writes the golden replays of packages/engine/test/replays.
 * Each one is a desync report of a scripted game whose hashes are the
 * reference every runtime must reach. Run it after a change that is meant to
 * alter games, a balance value above all, and commit the files it writes.
 */

interface Golden {
  readonly name: string;
  readonly map: string;
  readonly seed: number;
  readonly bots: number;
  readonly difficulty: BotDifficulty;
  readonly ticks: number;
}

export const GOLDEN_REPLAYS: readonly Golden[] = [
  { name: "europe-normal", map: "europe", seed: 7, bots: 11, difficulty: "normal", ticks: 3000 },
  { name: "world-hard", map: "world", seed: 11, bots: 7, difficulty: "hard", ticks: 2000 },
];

/** Ticks between two hashes in a golden replay, as online clients send them. */
export const GOLDEN_HASH_INTERVAL = 50;

interface PublishedManifest extends MapDescription {
  readonly format: number;
  readonly version: number;
}

const maps = new URL("../../apps/client/public/maps/", import.meta.url);

function record(golden: Golden): DesyncReport {
  const manifest = JSON.parse(
    readFileSync(new URL(`${golden.map}.json`, maps), "utf8"),
  ) as PublishedManifest;
  const { terrain } = loadMap(readFileSync(new URL(`${golden.map}.bin`, maps)), manifest);
  const { topology } = terrain;
  const players = Array.from({ length: golden.bots + 1 }, (_, i) => ({
    id: i + 1,
    name: i === 0 ? "Player" : `Bot ${String(i)}`,
  }));
  const bots = players.slice(1).map((player) => player.id);
  const game = createGame({ terrain, seed: golden.seed, players, balance: DEFAULT_BALANCE });
  installBots(game, bots, golden.difficulty);

  // The scripted player: a start near the middle of the map, then a third of
  // its troops every five seconds at free land, else the first neighbour,
  // else by sea. When its gold allows, it also builds a city near its start,
  // or else a fort.
  let start = topology.index(Math.floor(topology.width / 2), Math.floor(topology.height / 3));
  while (!terrain.isOwnable(start)) start = (start + 1) % topology.size;
  const around = new Int32Array(4);
  const every = 5 * DEFAULT_BALANCE.ticksPerSecond;
  const human = game.player(1);
  if (!human) throw new Error("no player 1");
  const choose = (): Order | undefined => {
    const troops = Math.floor(human.troops / 3);
    if (troops < 1) return undefined;
    let enemy = -1;
    const borders = game.territory.borderCount(1);
    for (let i = 0; i < borders; i++) {
      const count = topology.neighborsInto(game.territory.borderTile(1, i), around);
      for (let j = 0; j < count; j++) {
        const tile = around[j] as number;
        if (!terrain.isOwnable(tile) || game.territory.ownerOf(tile) === 1) continue;
        if (game.territory.ownerOf(tile) === 0) return { type: "attack", target: tile, troops };
        if (enemy < 0) enemy = tile;
      }
    }
    if (enemy >= 0) return { type: "attack", target: enemy, troops };
    const [coast] = reachableCoasts(game, 1, 1, (_, distance) => distance >= 16);
    return coast === undefined ? undefined : { type: "embark", target: coast, troops };
  };

  const build = (): Order | undefined => {
    for (const structure of [StructureKind.City, StructureKind.Fort]) {
      for (const tile of topology.tilesWithin(start, 30)) {
        const order: Order = { type: "build", structure, tile };
        if (orderError(game, human, order) === undefined) return order;
      }
    }
    return undefined;
  };

  const turns: Turn[] = [];
  const hashes: DesyncReport["hashes"] = [];
  while (game.tick < golden.ticks) {
    const tick = game.tick;
    const orders: Order[] = [];
    if (tick === 0) orders.push({ type: "spawn", tile: start });
    else if (game.phase === "play" && human.alive && tick % every === 0) {
      for (const order of [build(), choose()]) if (order) orders.push(order);
    }
    const turn: Turn = { tick, orders: orders.map((order) => ({ player: 1, order })) };
    if (orders.length > 0) turns.push(turn);
    game.step(turn);
    if ((tick + 1) % GOLDEN_HASH_INTERVAL === 0) {
      const hash = game.hash();
      hashes.push({ tick, local: hash, expected: hash });
    }
  }
  return {
    version: DESYNC_REPORT_VERSION,
    build: { release: "golden", protocol: PROTOCOL_VERSION },
    map: {
      id: golden.map,
      format: manifest.format,
      version: manifest.version,
      sha256: manifest.terrain.sha256,
    },
    seed: golden.seed,
    balance: DEFAULT_BALANCE,
    players,
    bots: { ids: bots, difficulty: golden.difficulty },
    you: 1,
    ticks: game.tick,
    turns,
    hashes,
  };
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  for (const golden of GOLDEN_REPLAYS) {
    const report = record(golden);
    const file = new URL(`../../packages/engine/test/replays/${golden.name}.json`, import.meta.url);
    writeFileSync(file, `${JSON.stringify(report)}\n`);
    console.log(
      `${golden.name}: ${String(report.turns.length)} turns with orders, ` +
        `${String(report.hashes.length)} hashes, last ${(report.hashes.at(-1)?.local ?? 0).toString(16)}`,
    );
  }
}
