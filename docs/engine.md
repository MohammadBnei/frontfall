# Engine API

`@frontfall/engine` is the deterministic simulation every client runs ([ADR 0001](adr/0001-deterministic-lockstep.md)). It has no dependency and no access to the browser, Node, the clock or `Math.random`. This page describes what the client, the server and the tools may use; anything not exported from `packages/engine/src/index.ts` is internal.

## Starting a game

```ts
import { createGame, Terrain, TileKind, WorldGrid } from "@frontfall/engine";

const grid = new WorldGrid(1000, 500); // wraps east-west; { wrapsX: false } for a flat map
const terrain = new Terrain(grid, kinds); // one TileKind per tile, from the map loader
const game = createGame({
  terrain,
  seed, // from the server: every client must use the same one
  players: [
    { id: 1, name: "Ada" },
    { id: 2, name: "Bea" },
  ],
  balance, // optional, defaults to DEFAULT_BALANCE
});
```

Player ids are integers from 1 upwards; `0` (`NEUTRAL`) is the owner of unclaimed land. `createGame` installs every rule in the order they depend on: spawn, attacks, growth, victory.

## Running it

The game advances one tick per turn. A turn lists the orders the server accepted during that tick, in the order it accepted them:

```ts
game.step({
  tick: game.tick, // turns must arrive in sequence; anything else throws
  orders: [
    { player: 1, order: { type: "spawn", tile } },
    { player: 2, order: { type: "attack", target: tile, troops: 500 } },
  ],
});
```

Every order is validated before it runs (`orderError` gives the reason for a refusal), so an order from the network can never corrupt the game: invalid orders and orders of eliminated players are skipped. `step` returns how many orders were carried out.

| Order                                | Rules                  | Effect                                                                                                                               |
| ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `{ type: "spawn", tile }`            | `R-SPAWN-01` to `-05`  | During the spawn phase: start at `tile`, or move the start there.                                                                    |
| `{ type: "attack", target, troops }` | `R-ATTACK-01` to `-09` | After the spawn phase: send `troops` against the owner of `target` (a player, or unowned land). The front advances towards `target`. |
| `{ type: "retreat", attack }`        | `R-ATTACK-06`          | Call back one of your attacks by id (`game.attacks`); its troops return, minus `B-RETREAT-PENALTY`.                                  |

Computer players do not go through turns: they run inside the engine and call `game.apply(player, order)` during a tick, the same path and checks as turn orders (`R-BOT-03`).

## Reading the state

| What                           | How                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Tick and phase                 | `game.tick`, `game.phase` (`"spawn"` or `"play"`)                                                              |
| Players                        | `game.players()` in id order, `game.player(id)`: `troops`, `gold`, `alive`                                     |
| Owner of a tile                | `game.territory.ownerOf(tile)`; the whole map in `game.territory.owners` (`Uint16Array`, read only)            |
| Territory size, borders        | `game.territory.tileCount(id)`, `borderCount(id)`, `borderTile(id, i)`, `isBorder(tile)`                       |
| Tiles changed since last frame | `game.territory.changes()`, then `clearChanges()`; redraw everything if `changesOverflowed`                    |
| Attacks under way              | `attacks.list()`: player, target owner, aimed tile, troops                                                     |
| Start tiles                    | `starts.get(id)`                                                                                               |
| Result                         | `victory.winner()`, `victory.decidedAt()`                                                                      |
| Geometry                       | `game.terrain.topology`: `neighbors`, `distance`, `tilesWithin`, `toLatLon` ([ADR 0002](adr/0002-topology.md)) |
| Terrain                        | `game.terrain.kind(tile)`, `game.terrain.isOwnable(tile)`                                                      |

The state objects are live: read them, never write them. A renderer reads after each `step`; the engine never calls the renderer ([ADR 0003](adr/0003-renderer-split.md)).

## Balance

`DEFAULT_BALANCE` holds the values of [balance.md](balance.md), converted to ticks and integers. Each field names its `B-` key. Tests and private lobbies may pass their own `balance`; a multiplayer game must use the same one on every client.

## Helpers

- `Random`: the seeded generator. Anything random in a game comes from `game.random`.
- `clamp`, `divFloor`, `mulDiv`, `percentOf`, `isqrt`: exact integer arithmetic for game state.
- `TerritoryMap`, `BoundedFloodFill`: the ownership store and a bounded fill, for engine code.

## Extending the engine

A new rule is a function `installX(game)` that registers order handlers (`game.onOrder`) and tick systems (`game.onTick`), cites its rule identifiers, and is added to `createGame` in the right place. Its state lives on `Game` or `Player`, never in a closure, so that `game.hash()` covers it and a game can later be saved and restored. It draws randomness from `game.random` and comes with tests that name the rules they cover. A change to any outcome changes the pinned hash in `test/hash.test.ts`: update it on purpose, and record the change in the changelog.
