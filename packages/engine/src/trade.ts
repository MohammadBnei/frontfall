import { embargoed } from "./diplomacy.ts";
import type { Game } from "./game.ts";
import { DrawUsage, derivedRandom } from "./random.ts";
import { SeaRoutes } from "./sea-routes.ts";
import { StructureKind, isReady, type Structure } from "./structures.ts";

/** A trade ship sailing from one port to another (R-UNIT-03). */
export interface TradeShip {
  readonly id: number;
  /** Owner of the port it left, when it left; paid on arrival. */
  readonly player: number;
  /** Port tiles it sails from and to. */
  readonly from: number;
  readonly to: number;
  /** Water tiles from the port it left to the one it sails for; shared with the route, never written. */
  readonly path: Int32Array;
  /** How far along `path` the ship is; it arrives once this reaches `path.length`. */
  step: number;
}

/**
 * Trade (R-BUILD-02, R-UNIT-03, R-DIPLO-05). A port opens once built and
 * finds its routes to every open port within B-TRADE-RANGE of sea. Every
 * B-TRADE-INTERVAL after it opened, a port with fewer than B-TRADE-MAX of its
 * ships at sea sends one to a port of another player, drawn among those it
 * has a route to and no embargo cuts it off from. The ship sails at
 * B-BOAT-SPEED; if a port of another player still stands at the end and no
 * embargo has come between the two, both players earn B-TRADE-BASE plus
 * B-TRADE-PER-TILE for each water tile of the route. Otherwise it is lost.
 * A fallen player's trade ships sink. Runs after structures change hands.
 */
export function installTrade(game: Game): void {
  const { balance } = game;
  const routes = new SeaRoutes(game, balance.tradeRange);
  const ships = game.tradeShips;
  /** Ready ports by tile, rebuilt every tick. */
  const ports = new Map<number, Structure>();

  game.onTick(() => {
    ports.clear();
    for (const structure of game.structures) {
      if (structure.kind === StructureKind.Port && isReady(game, structure)) {
        ports.set(structure.tile, structure);
      }
    }
    for (const tile of routes.openPorts()) if (!ports.has(tile)) routes.close(tile);
    // Oldest first, so every client opens them in the same order and finds the same routes.
    for (const tile of ports.keys()) routes.open(tile);

    let kept = 0;
    for (const ship of ships) {
      if (!game.player(ship.player)?.alive) continue;
      ship.step = Math.min(ship.step + balance.boatSpeed, ship.path.length);
      if (ship.step === ship.path.length) arrive(ship);
      else ships[kept++] = ship;
    }
    ships.length = kept;

    for (const port of ports.values()) {
      const open = game.tick - port.readyAt;
      if (open === 0 || open % balance.tradeIntervalTicks !== 0) continue;
      let atSea = 0;
      for (const ship of ships) if (ship.from === port.tile) atSea++;
      if (atSea >= balance.tradeMax) continue;
      const partners = routes.partnersOf(port.tile).filter((tile) => trades(port.player, tile));
      if (partners.length === 0) continue;
      const draw = derivedRandom(game.seed, game.tick, port.id, DrawUsage.TradeDestination);
      const to = partners[draw % partners.length] as number;
      ships.push({
        id: game.nextTradeShipId++,
        player: port.player,
        from: port.tile,
        to,
        path: routes.route(port.tile, to) as Int32Array,
        step: 0,
      });
    }
  });

  /** Whether `player` trades with the port on `tile`: another player's, alive, and no embargo between them. */
  function trades(player: number, tile: number): boolean {
    const owner = ports.get(tile)?.player;
    if (owner === undefined || owner === player) return false;
    return game.player(owner)?.alive === true && !embargoed(game, player, owner);
  }

  function arrive(ship: TradeShip): void {
    if (!trades(ship.player, ship.to)) return;
    const gain = balance.tradeBase + balance.tradePerTile * ship.path.length;
    const sender = game.player(ship.player);
    const receiver = game.player(ports.get(ship.to)?.player ?? 0);
    if (!sender || !receiver) return;
    sender.gold += gain;
    receiver.gold += gain;
  }
}
