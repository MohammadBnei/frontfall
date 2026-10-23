import type { Game, Order, Player } from "./game.ts";

/**
 * Why an order cannot be carried out in the current state, or undefined when
 * it can. Orders come from the network, so nothing about them is trusted:
 * every field is checked here before any handler sees the order.
 */
export function orderError(game: Game, player: Player, order: Order): string | undefined {
  switch (order.type) {
    case "spawn":
      if (game.phase !== "spawn") return "the spawn phase is over";
      return tileError(game, order.tile);
    case "attack": {
      // R-SPAWN-05: nobody attacks during the spawn phase.
      if (game.phase !== "play") return "attacks start after the spawn phase";
      const error = tileError(game, order.target);
      if (error) return error;
      if (!Number.isSafeInteger(order.troops) || order.troops < 1) return "invalid troop count";
      if (order.troops > player.troops) return "not enough troops";
      if (game.territory.ownerOf(order.target) === player.id) return "the target is already owned";
      return undefined;
    }
    case "embark": {
      if (game.phase !== "play") return "attacks start after the spawn phase";
      const error = tileError(game, order.target);
      if (error) return error;
      if (!Number.isSafeInteger(order.troops) || order.troops < 1) return "invalid troop count";
      if (order.troops > player.troops) return "not enough troops";
      if (game.territory.ownerOf(order.target) === player.id) return "the target is already owned";
      if (!game.terrain.isCoast(order.target)) return "ships can only land on a coast";
      const atSea = game.boats.filter((boat) => boat.player === player.id).length;
      if (atSea >= game.balance.boatMax) return "too many ships at sea";
      return undefined;
    }
    case "retreat":
      if (game.phase !== "play") return "attacks start after the spawn phase";
      if (!Number.isSafeInteger(order.attack) || order.attack < 1) return "invalid attack id";
      return undefined;
  }
}

function tileError(game: Game, tile: number): string | undefined {
  if (!Number.isInteger(tile) || tile < 0 || tile >= game.terrain.topology.size) {
    return "the tile is outside the map";
  }
  if (!game.terrain.isOwnable(tile)) return "the tile cannot be owned";
  return undefined;
}
