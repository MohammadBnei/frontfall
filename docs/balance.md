# Balance values

Status: starting values, not yet play-tested · Rules: [rules.md](rules.md)

Every number the rules depend on lives here. The values are Frontfall's own starting points and will move with play-testing; each change goes through a pull request that explains what it fixes in play. When the engine implements a value, its constant carries the same key in a comment so the two stay linked.

Durations are given in seconds of play and converted to ticks with `B-TICK-RATE`. Percentages apply to whole numbers and round down (`R-ECO-04`).

## Time

| Key              | Value | Unit         | Used by      | Notes                                              |
| ---------------- | ----: | ------------ | ------------ | -------------------------------------------------- |
| `B-TICK-RATE`    |    10 | ticks/second | `R-FAIR-03`  | Fixed by the protocol (`TICK_RATE`)                |
| `B-SPAWN-PHASE`  |    20 | s            | `R-SPAWN-01` | Long enough to read the map, short enough to start |
| `B-MAX-DURATION` |  3600 | s            | `R-WIN-02`   | One hour                                           |

## Spawn

| Key                | Value | Unit   | Used by      | Notes                                           |
| ------------------ | ----: | ------ | ------------ | ----------------------------------------------- |
| `B-SPAWN-DISTANCE` |    30 | tiles  | `R-SPAWN-02` | On a map of 2^19 tiles                          |
| `B-SPAWN-RADIUS`   |     3 | tiles  | `R-SPAWN-04` | Diamond of 25 tiles on a map of 2^19 tiles      |
| `B-START-TROOPS`   |  2500 | troops | `R-SPAWN-04` | Enough for a first expansion of about 300 tiles |

Spawn values are set for a map of 2^19 tiles (1024 × 512) (`R-SPAWN-06`). On a larger map, spacing and radius grow with the square root of the area, and starting troops with the start area: on World (2048 × 1024) players start 60 tiles apart with a radius of 6 and 10,000 troops. With the old fixed values, scripted players held 5 % of World's land after 30 s of play; they now hold 17 %, and the land is taken in about 90 s instead of 150 s (`pnpm sim -- --map world`).

## Economy

| Key                   | Value | Unit                        | Used by     | Notes                                          |
| --------------------- | ----: | --------------------------- | ----------- | ---------------------------------------------- |
| `B-POP-BASE`          | start | troops                      | `R-ECO-01`  | The map's starting troops (`R-SPAWN-06`)       |
| `B-POP-PER-TILE`      |    40 | troops                      | `R-ECO-01`  | Cap contribution of each owned land tile       |
| `B-POP-PER-CITY`      | 25000 | troops                      | `R-ECO-01`  |                                                |
| `B-POP-FALLOFF-SHARE` |    20 | % of all ownable land       | `R-ECO-06`  | Land past this share counts for less           |
| `B-POP-FALLOFF`       |   100 | % of `B-POP-PER-TILE`       | `R-ECO-06`  | What each tile past that share adds to the cap |
| `B-GROWTH-RATE`       |   3.2 | % of the gap to cap/second  | `R-ECO-02`  | Applied per tick as an integer ratio           |
| `B-GOLD-RATE`         |   0.5 | gold per 100 idle troops/s  | `R-ECO-03`  |                                                |
| `B-TRADE-GOLD`        |    60 | gold per 100 tiles of route | `R-UNIT-03` | Paid to both ports on arrival                  |

## Attacks

| Key                  |         Value | Unit                        | Used by       | Notes                                       |
| -------------------- | ------------: | --------------------------- | ------------- | ------------------------------------------- |
| `B-ATTACK-RATIO-MIN` |             5 | %                           | `R-ATTACK-02` | Default ratio in the interface is 30 %      |
| `B-NEUTRAL-COST`     |             8 | troops/tile                 | `R-ATTACK-04` |                                             |
| `B-RELIEF-COST`      | 1 / 1.5 / 2.5 | multiplier                  | `R-MAP-06`    | Plains / hills / mountains                  |
| `B-DEFENSE-DENSITY`  |           1.0 | defender troops/tile weight | `R-ATTACK-03` | Cost of a tile grows with defender density  |
| `B-ATTACK-SPEED`     |             4 | divisor                     | `R-ATTACK-03` | Tiles taken per tick: 1 + isqrt(troops) / 4 |
| `B-ATTACK-SPREAD`    |             4 | tiles                       | `R-ATTACK-03` | Head start per side shared with own land    |
| `B-ENCIRCLE-MAX`     |          4000 | tiles                       | `R-ATTACK-08` | Larger pockets must be conquered            |
| `B-RETREAT-PENALTY`  |            25 | % of returning troops       | `R-ATTACK-06` |                                             |

## Ships

| Key            | Value | Unit             | Used by     | Notes                                             |
| -------------- | ----: | ---------------- | ----------- | ------------------------------------------------- |
| `B-BOAT-SPEED` |     2 | water tiles/tick | `R-UNIT-02` | An ocean of 500 tiles takes 25 s                  |
| `B-BOAT-MAX`   |     3 | ships per player | `R-UNIT-02` | Transport ships at sea at once                    |
| `B-BOAT-RANGE` |  1000 | water tiles      | `R-UNIT-02` | Longest route; also bounds the cost of the search |

## Diplomacy

| Key                          | Value | Unit | Used by      | Notes                                  |
| ---------------------------- | ----: | ---- | ------------ | -------------------------------------- |
| `B-ALLIANCE-REQUEST-TIMEOUT` |    20 | s    | `R-DIPLO-01` |                                        |
| `B-ALLIANCE-DURATION`        |   300 | s    | `R-DIPLO-03` | Renewal opens in the last 60 s         |
| `B-TRAITOR-DURATION`         |    30 | s    | `R-DIPLO-04` | Defense reduced by half while it lasts |

## Structures

| Key                    | Value | Unit       | Used by      | Notes                                                      |
| ---------------------- | ----: | ---------- | ------------ | ---------------------------------------------------------- |
| `B-BUILD-TIME`         |     5 | s          | `R-BUILD-*`  | Missile silo and air defense: 10 s                         |
| `B-COST-GROWTH`        |   1.5 | multiplier | `R-BUILD-*`  | Cost of the n-th structure: base × 1.5^(n−1), capped at 5× |
| `B-FORT-RADIUS`        |    25 | tiles      | `R-BUILD-03` | Losses halved inside the radius                            |
| `B-AIR-DEFENSE-RADIUS` |    60 | tiles      | `R-BUILD-05` | 75 % chance to stop each missile                           |

Base costs, in gold: city 120 000, port 100 000, fort 50 000, missile silo 800 000, air defense 1 000 000.

## Bots

Each value is given for easy / normal / hard (`R-BOT-04`); the last four are the same at every difficulty.

| Key                  |           Value | Unit                         | Used by    | Notes                                                                                                                                          |
| -------------------- | --------------: | ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `B-BOT-INTERVAL`     |       5 / 3 / 2 | s between decisions          | `R-BOT-01` | Bots spread their decisions over the interval                                                                                                  |
| `B-BOT-ATTACK-RATIO` |    15 / 25 / 35 | % of troops at home          | `R-BOT-01` | Sent by one expansion or attack order                                                                                                          |
| `B-BOT-RESERVE`      |    50 / 40 / 30 | % of population cap          | `R-BOT-01` | Never sent; kept at home to defend                                                                                                             |
| `B-BOT-BOLDNESS`     | 100 / 110 / 125 | % of the bot's troop density | `R-BOT-01` | Attacks a neighbour at most this dense; half while land is free. Equal density is worth attacking: spent troops grow back, captured land stays |
| `B-BOT-SAMPLES`      |              16 | border tiles per decision    | `R-BOT-05` | At least this many, or the square root of the border when longer, so a narrow land front is found                                              |
| `B-BOT-SEA-TARGETS`  |               8 | coasts per sea search        | `R-BOT-05` | Weighed closest first                                                                                                                          |
| `B-BOT-SEA-MIN`      |              16 | water tiles                  | `R-BOT-05` | Coasts closer to the bot's shore count as the same front                                                                                       |
| `B-BOT-SEA-RETRY`    |               4 | decisions                    | `R-BOT-05` | Skipped after a sea search that found nothing, since one search can walk `B-BOAT-RANGE` of sea                                                 |

Bot values were tuned on World against a scripted stand-in for a casual player (an order every 5 s with 30 % of its troops, unowned land first, then its weakest neighbour), three seeds, seven bots. With the first values, hard bots wiped it out in under 3 minutes in two games out of three; with these, it survives every game at every difficulty, and the leading hard bot holds about half the land after 4 minutes, against a quarter for easy bots.

`B-POP-FALLOFF` is off (100 %) for now. It was tried at 50 % past 20 % of the land with eight hard bots on World, five seeds, once bots had learnt to sail (`R-BOT-05`). The leader reached `B-WIN-SHARE` in 7 to 8 minutes in every seed, with or without it. Against seven hard bots over eight minutes, the scripted casual player was eliminated in four seeds out of six with it (after 5.1 to 7.2 minutes), in five out of six without it (after 4.5 to 6.0), and in four out of six with the previous bots (after 3.8 to 6.3). On a small map with three bots, though, every bot is past the share, and with the falloff the lead changed hands for 15 minutes; without it, the game was won in under 2 minutes. That gain for the casual player is within noise, so it does not pay for the stalemates.

With ships for everyone, a scripted player that also sails (free land first, then its weakest neighbour, then a ship to a free or weaker coast, 30 % of its troops every 5 s) wins most solo games: against 7 normal bots on World, 7 seeds out of 8, in 5.5 to 7.2 minutes; against the menu's default of 11 normal bots on Europe, 5 out of 6, in 4.3 to 5.4 minutes. Against 7 hard bots on World it wins 2 seeds out of 4. A real casual player is slower than this script, so these are upper bounds; playtests decide whether normal bots need to be bolder.

## Victory

| Key           | Value | Unit              | Used by    | Notes |
| ------------- | ----: | ----------------- | ---------- | ----- |
| `B-WIN-SHARE` |    75 | % of ownable land | `R-WIN-01` |       |
