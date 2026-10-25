import {
  BuildError,
  MissileError,
  MissileSize,
  StructureKind,
  TileKind,
  WarshipError,
  isAllied,
  orderError,
  sameTeam,
  seaRoute,
  type Game,
  type Order,
  type Structure,
} from "@frontfall/engine";
import type { ClickMode, ClickRefusal, ClickResult, StructureType } from "./game-view.ts";

/** Tiles around a click within which a demolition finds the player's structure: one is a few pixels wide. */
const DEMOLISH_REACH = 3;
/**
 * Tiles around a click within which a port finds the player's coast: on a
 * large map the coast is a line under a pixel wide, so a click by the water,
 * on the land or the sea, picks the closest coast tile that takes a port.
 */
const PORT_REACH = 8;

const STRUCTURE_KINDS: Readonly<Record<StructureType, StructureKind>> = {
  city: StructureKind.City,
  palace: StructureKind.Palace,
  fort: StructureKind.Fort,
  port: StructureKind.Port,
  silo: StructureKind.Silo,
  airDefense: StructureKind.AirDefense,
};

/** Engine refusals of a build order, as the interface explains them: one for each BuildError. */
const BUILD_REFUSALS: Readonly<Record<BuildError, ClickRefusal>> = {
  [BuildError.Early]: "early",
  [BuildError.Foreign]: "foreign",
  [BuildError.Crowded]: "crowded",
  [BuildError.Land]: "land",
  [BuildError.Coast]: "coast",
  [BuildError.Gold]: "gold",
  [BuildError.Disabled]: "disabled",
};

function isBuildError(error: string): error is BuildError {
  return Object.hasOwn(BUILD_REFUSALS, error);
}

/**
 * What a click on `tile` means for the human now: pick a start during the
 * spawn phase, then expand or attack with `ratio` percent of their troops,
 * by land when the target touches their land, by sea when it is a coast
 * on another land mass. Otherwise, why nothing happens.
 */
export function orderForClick(
  game: Game,
  you: number,
  tile: number,
  ratio: number,
  mode: ClickMode = "attack",
): ClickResult {
  const { terrain, territory } = game;
  const human = game.player(you);
  if (!human?.alive || game.winner !== undefined) return { refused: "over" };
  if (!Number.isInteger(tile) || tile < 0 || tile >= terrain.topology.size) {
    return { refused: "terrain" };
  }
  if (mode === "demolish") return demolishNear(game, you, tile);
  if (mode === "warship") return warshipFor(game, you, tile);
  if (mode === "missile" || mode === "heavyMissile") {
    return missileAt(game, you, tile, mode === "heavyMissile");
  }
  if (mode === "port") return portNear(game, you, tile);
  if (!terrain.isOwnable(tile)) return { refused: "terrain" };
  if (game.phase === "play" && isAllied(game, you, territory.ownerOf(tile)) && mode === "attack") {
    return { refused: sameTeam(game, you, territory.ownerOf(tile)) ? "teammate" : "ally" };
  }
  if (
    mode === "city" ||
    mode === "palace" ||
    mode === "fort" ||
    mode === "silo" ||
    mode === "airDefense"
  ) {
    const order: Order = { type: "build", structure: STRUCTURE_KINDS[mode], tile };
    const error = orderError(game, human, order);
    if (error === undefined) return { order };
    // The tile was checked above: anything else is a placement rule.
    return { refused: isBuildError(error) ? BUILD_REFUSALS[error] : "terrain" };
  }
  if (game.phase === "spawn") return { order: { type: "spawn", tile } };
  if (territory.ownerOf(tile) === you) return { refused: "own" };
  const troops = Math.floor((human.troops * Math.min(100, Math.max(0, ratio))) / 100);
  if (troops < 1) return { refused: "troops" };

  // By land when the player borders the target's owner on the target's own
  // land mass: an attack starts from that border, so it must reach the click.
  const owner = territory.ownerOf(tile);
  const mass = terrain.landmassOf(tile);
  const around = new Int32Array(4);
  let touches = false;
  for (let i = 0; i < territory.borderCount(you) && !touches; i++) {
    const border = territory.borderTile(you, i);
    if (terrain.landmassOf(border) !== mass) continue;
    const count = terrain.topology.neighborsInto(border, around);
    for (let j = 0; j < count; j++) {
      const next = around[j] as number;
      if (territory.ownerOf(next) === owner && terrain.isOwnable(next)) touches = true;
    }
  }
  if (touches) {
    return { order: { type: "attack", target: tile, troops } };
  }
  if (terrain.isCoast(tile) && seaRoute(game, you, tile)) {
    const atSea = game.boats.filter((boat) => boat.player === you).length;
    if (atSea >= game.balance.boatMax) return { refused: "ships" };
    return { order: { type: "embark", target: tile, troops } };
  }
  return { refused: "unreachable" };
}

/**
 * In port mode: a port on the player's coast tile closest to the click,
 * within PORT_REACH, among those that take one. When none does, the refusal
 * is the one of the closest coast tile, or "coast" when the player holds
 * no coast there.
 */
function portNear(game: Game, you: number, tile: number): ClickResult {
  const { terrain, territory } = game;
  const human = game.player(you);
  if (!human) return { refused: "over" };
  const topology = terrain.topology;
  let refusal: { error: string; distance: number } | undefined;
  let best: { tile: number; distance: number } | undefined;
  for (const near of topology.tilesWithin(tile, PORT_REACH)) {
    if (territory.ownerOf(near) !== you || !terrain.isCoast(near)) continue;
    const distance = topology.squaredDistance(near, tile);
    const order: Order = { type: "build", structure: StructureKind.Port, tile: near };
    const error = orderError(game, human, order);
    if (error === undefined) {
      if (!best || distance < best.distance) best = { tile: near, distance };
    } else if (!refusal || distance < refusal.distance) {
      refusal = { error, distance };
    }
  }
  if (best) {
    const order: Order = { type: "build", structure: StructureKind.Port, tile: best.tile };
    return terrain.isOceanCoast(best.tile) ? { order } : { order, note: "lake" };
  }
  if (!refusal) {
    // No coast of the player's near: the click itself says why (the phase,
    // a left-out port, someone else's land), and on the sea, "coast".
    const error = orderError(game, human, {
      type: "build",
      structure: StructureKind.Port,
      tile,
    });
    return {
      refused: error !== undefined && isBuildError(error) ? BUILD_REFUSALS[error] : "coast",
    };
  }
  return { refused: isBuildError(refusal.error) ? BUILD_REFUSALS[refusal.error] : "terrain" };
}

/** In a missile mode: a launch at the tile clicked, land or not, from the closest loaded silo. */
function missileAt(game: Game, you: number, tile: number, heavy: boolean): ClickResult {
  const human = game.player(you);
  if (!human) return { refused: "over" };
  if (!game.terrain.isOwnable(tile)) return { refused: "terrain" };
  const order: Order = {
    type: "missile",
    target: tile,
    size: heavy ? MissileSize.Heavy : MissileSize.Light,
  };
  const error = orderError(game, human, order);
  if (error === undefined) return { order };
  if (error === MissileError.Early) return { refused: "early" };
  if (error === MissileError.Ally) {
    return {
      refused: sameTeam(game, you, game.territory.ownerOf(tile)) ? "teammate" : "ally",
    };
  }
  if (error === MissileError.Near) return { refused: "allyNear" };
  if (error === MissileError.Gold) return { refused: "gold" };
  return { refused: "silo" };
}

/**
 * In warship mode: a click near the player's port buys a warship there; a
 * click on water sends the player's closest warship that can reach it to
 * patrol around it.
 */
function warshipFor(game: Game, you: number, tile: number): ClickResult {
  const human = game.player(you);
  if (!human) return { refused: "over" };
  if (game.phase !== "play") return { refused: "early" };
  if (game.terrain.kind(tile) === TileKind.Water) {
    const topology = game.terrain.topology;
    const ships = game.warships
      .filter((warship) => warship.player === you)
      .map((warship) => ({ id: warship.id, distance: topology.distance(warship.tile, tile) }))
      .sort((a, b) => a.distance - b.distance);
    for (const { id } of ships) {
      const order: Order = { type: "patrol", ship: id, tile };
      if (orderError(game, human, order) === undefined) return { order };
    }
    return { refused: "noWarship" };
  }
  // A click near the port finds it, as far as a click that built it reaches.
  const port = structureNear(game, you, tile, (s) => s.kind === StructureKind.Port, PORT_REACH);
  if (!port) return { refused: "port" };
  const order: Order = { type: "warship", port: port.tile };
  const error = orderError(game, human, order);
  if (error === undefined) return { order };
  if (error === WarshipError.Max) return { refused: "warships" };
  if (error === WarshipError.Gold) return { refused: "gold" };
  if (error === WarshipError.Shore) return { refused: "shore" };
  if (error === WarshipError.Disabled) return { refused: "disabled" };
  return { refused: "port" };
}

function demolishNear(game: Game, you: number, tile: number): ClickResult {
  const structure = structureNear(game, you, tile, () => true);
  return structure ? { order: { type: "demolish", tile: structure.tile } } : { refused: "nothing" };
}

/** The player's structure closest to the click and passing `accept`, within `reach` tiles. */
function structureNear(
  game: Game,
  you: number,
  tile: number,
  accept: (structure: Structure) => boolean,
  reach = DEMOLISH_REACH,
): Structure | undefined {
  const topology = game.terrain.topology;
  let best: Structure | undefined;
  let bestDistance = 0;
  for (const structure of game.structures) {
    if (structure.player !== you || !accept(structure)) continue;
    const distance = topology.distance(structure.tile, tile);
    if (distance <= reach && (!best || distance < bestDistance)) {
      best = structure;
      bestDistance = distance;
    }
  }
  return best;
}
