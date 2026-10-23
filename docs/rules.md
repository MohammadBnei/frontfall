# Game rules

Status: v1 draft · Owner: maintainers · Balance values: [balance.md](balance.md)

This document is the single source of truth for how Frontfall plays. It describes what a player sees and can do, not how the code does it. Code, tests and pull requests refer to rules by identifier, for example `R-ATTACK-03`. A change to the game starts with a change to this file.

Numbers are never written here. Each tunable value has a key such as `B-GROWTH-RATE`, defined in [balance.md](balance.md), so balancing a game never edits the rules.

Words used throughout:

| Term        | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| Tile        | Smallest square of the map. Every rule about space counts in tiles.      |
| Tick        | One step of the simulation. There are `B-TICK-RATE` ticks per second.    |
| Territory   | The set of tiles a player owns.                                          |
| Border tile | An owned tile with at least one neighbour the player does not own.       |
| Troops      | The single resource that grows, attacks and defends.                     |
| Gold        | Currency spent on structures and units.                                  |
| Neighbour   | One of the four tiles sharing an edge, across the east-west seam if any. |

## 1. Map

- **R-MAP-01** The map is a grid of tiles. Each tile is land or water, and land has a relief level: plains, hills or mountains.
- **R-MAP-02** Some land is impassable: no player can own it and nothing can cross it. Ice caps near the poles are impassable by default.
- **R-MAP-03** A map either has edges on all four sides (flat) or wraps east to west (cylinder): moving east from the last column leads to the first one. North and south are always edges.
- **R-MAP-04** Distances and neighbours always take the shorter way around a wrapped map. No rule may treat the seam differently from any other column.
- **R-MAP-05** Water is either ocean (connected to the map's largest body of water) or a lake. Ships can only use water connected to the port they come from.
- **R-MAP-06** Relief slows conquest: capturing hills and mountains costs more troops and time than plains (`B-RELIEF-COST`).

## 2. Joining and spawning

- **R-SPAWN-01** A game starts with a spawn phase lasting `B-SPAWN-PHASE`. During it, each player picks a land tile to start from. Picking again moves the start.
- **R-SPAWN-02** A start tile must be unowned land, not impassable, and at least `B-SPAWN-DISTANCE` tiles from every other start.
- **R-SPAWN-03** A player who has not picked when the phase ends is placed on a random valid tile, drawn from the game's seed.
- **R-SPAWN-04** Each player starts with the tiles within `B-SPAWN-RADIUS` of their start tile, and `B-START-TROOPS` troops.
- **R-SPAWN-05** Nobody can attack or build during the spawn phase.

## 3. Economy

- **R-ECO-01** Each player has a population cap that grows with territory and cities (`B-POP-PER-TILE`, `B-POP-PER-CITY`).
- **R-ECO-02** Troops grow every tick. Growth is fastest when the player is far below the cap and falls to zero at the cap (`B-GROWTH-RATE`).
- **R-ECO-03** A player earns gold every tick in proportion to the troops they hold back from attacks (`B-GOLD-RATE`). Trade adds to this income (`R-UNIT-03`).
- **R-ECO-04** Troops and gold are whole numbers. When a computation produces a fraction, it is rounded down.
- **R-ECO-05** A player whose territory drops to zero tiles is eliminated. Their troops and gold are lost.

## 4. Expansion and attacks

- **R-ATTACK-01** A player expands by sending troops from their territory towards a target: unowned land or a neighbouring player.
- **R-ATTACK-02** The attack ratio, set by the player between `B-ATTACK-RATIO-MIN` and 100 %, decides the share of current troops each new attack takes.
- **R-ATTACK-03** An attack advances along the shared border, one tile at a time. Each captured tile costs the attacker troops, more for relief (`R-MAP-06`) and more against a defender with many troops per tile (`B-DEFENSE-DENSITY`).
- **R-ATTACK-04** Unowned land costs troops to take but never fights back (`B-NEUTRAL-COST`).
- **R-ATTACK-05** An attack ends when its troops run out, when no reachable target tile remains, or when its player retreats.
- **R-ATTACK-06** Retreating returns the attack's remaining troops to the player, minus a penalty (`B-RETREAT-PENALTY`).
- **R-ATTACK-07** Two attacks between the same players in opposite directions cancel out first: troops fight troops before any tile changes hands.
- **R-ATTACK-08** Territory that ends up surrounded by one other player, with no border to any third party, is captured by that player at once.
- **R-ATTACK-09** Players can attack across water only with ships (`R-UNIT-02`).

## 5. Diplomacy

- **R-DIPLO-01** A player can ask any other player for an alliance. The request expires after `B-ALLIANCE-REQUEST-TIMEOUT` if not accepted.
- **R-DIPLO-02** Allies cannot attack each other, and their units do not fire at each other.
- **R-DIPLO-03** An alliance lasts `B-ALLIANCE-DURATION`. Both players may renew it in the last part of that time.
- **R-DIPLO-04** Attacking an ally breaks the alliance. The attacker is marked a traitor for `B-TRAITOR-DURATION`: their defense is weakened and every player is told.
- **R-DIPLO-05** A player can place an embargo on another, which stops trade between them in both directions until lifted.
- **R-DIPLO-06** Players can send each other troops or gold. Gifts are refused between players at war.
- **R-DIPLO-07** Players can send preset quick messages and emoji to each other; free text chat is not part of v1.

## 6. Structures

Every structure is built on an owned land tile, costs gold, and takes `B-BUILD-TIME` before it works. Costs rise with the number of the same structure already owned (`B-COST-GROWTH`). A structure captured with its tile changes owner.

- **R-BUILD-01** City: raises the population cap (`R-ECO-01`).
- **R-BUILD-02** Port: built on a coastal tile. Launches ships and trade (`R-UNIT-02`, `R-UNIT-03`).
- **R-BUILD-03** Fort: troops defending tiles within `B-FORT-RADIUS` lose fewer troops per tile lost.
- **R-BUILD-04** Missile silo: launches missiles (`R-UNIT-05`). Needs a reload time between launches.
- **R-BUILD-05** Air defense: has a chance to destroy missiles that pass within its radius (`B-AIR-DEFENSE-RADIUS`).
- **R-BUILD-06** A structure can be demolished by its owner, with no refund.

## 7. Units

- **R-UNIT-01** Units move over the map, never through impassable terrain, and are visible to every player.
- **R-UNIT-02** Transport ship: leaves a port carrying troops and lands them on a coast, starting an attack there (`R-ATTACK-09`). It sinks if destroyed at sea, with its troops.
- **R-UNIT-03** Trade ship: travels on its own between ports of players not under embargo. Both ends earn gold on arrival, more for longer routes (`B-TRADE-GOLD`).
- **R-UNIT-04** Warship: patrols the water around its port, fires at enemy ships within range, and can capture trade ships.
- **R-UNIT-05** Missile: flies from a silo to a target tile and destroys structures and troops within its blast radius. Larger missiles also leave the land unusable for a time. Allies' territory cannot be targeted.

## 8. Bots and nations

- **R-BOT-01** Bots are simple players that fill empty maps: they expand into unowned land and attack weak neighbours, and never make alliances.
- **R-BOT-02** Nations are stronger computer players placed at named positions on a map. They build, ally, trade and retaliate when attacked.
- **R-BOT-03** Computer players follow the same rules as humans and send their orders the same way. They take decisions only from the game state and the game's seed, so every client computes the same decisions.
- **R-BOT-04** The difficulty setting changes how often and how boldly computer players act, never the rules they follow.

## 9. Victory and game modes

- **R-WIN-01** A player wins by owning `B-WIN-SHARE` of all ownable land, or by being the last player standing.
- **R-WIN-02** A game that reaches `B-MAX-DURATION` ends; the player with the most territory wins.
- **R-WIN-03** Eliminated players can keep watching the game.
- **R-MODE-01** Free-for-all: every player for themselves; alliances follow `R-DIPLO`.
- **R-MODE-02** Teams: players are split into teams of equal size. Team members are permanent allies and win together when their combined territory reaches `B-WIN-SHARE`.
- **R-MODE-03** Private lobbies let their creator choose the map, the mode, bots and nations, and disable structures or units.

## 10. Fairness and determinism

- **R-FAIR-01** Every client simulates the same game from the same seed and the same ordered list of player orders. The server checks orders but never decides outcomes.
- **R-FAIR-02** Any random choice in a game is drawn from the game's seed, never from the device.
- **R-FAIR-03** A player's orders take effect at the start of the next turn after the server receives them, in the order the server received them.

## Changing these rules

Open an issue describing the problem in play and the proposed rule. When the change is agreed, the pull request updates this file, adds or updates tests that cite the rule identifiers, and notes the change in [CHANGELOG.md](../CHANGELOG.md). Identifiers are never reused: a removed rule keeps its number, marked as withdrawn.
