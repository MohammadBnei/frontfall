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
| `B-SPAWN-DISTANCE` |    30 | tiles  | `R-SPAWN-02` |                                                 |
| `B-SPAWN-RADIUS`   |     3 | tiles  | `R-SPAWN-04` | Diamond of 25 tiles                             |
| `B-START-TROOPS`   |  2500 | troops | `R-SPAWN-04` | Enough for a first expansion of about 100 tiles |

## Economy

| Key              | Value | Unit                        | Used by     | Notes                                    |
| ---------------- | ----: | --------------------------- | ----------- | ---------------------------------------- |
| `B-POP-PER-TILE` |    40 | troops                      | `R-ECO-01`  | Cap contribution of each owned land tile |
| `B-POP-PER-CITY` | 25000 | troops                      | `R-ECO-01`  |                                          |
| `B-GROWTH-RATE`  |   3.2 | % of the gap to cap/second  | `R-ECO-02`  | Applied per tick as an integer ratio     |
| `B-GOLD-RATE`    |   0.5 | gold per 100 idle troops/s  | `R-ECO-03`  |                                          |
| `B-TRADE-GOLD`   |    60 | gold per 100 tiles of route | `R-UNIT-03` | Paid to both ports on arrival            |

## Attacks

| Key                  |         Value | Unit                        | Used by       | Notes                                       |
| -------------------- | ------------: | --------------------------- | ------------- | ------------------------------------------- |
| `B-ATTACK-RATIO-MIN` |             5 | %                           | `R-ATTACK-02` | Default ratio in the interface is 30 %      |
| `B-NEUTRAL-COST`     |             8 | troops/tile                 | `R-ATTACK-04` |                                             |
| `B-RELIEF-COST`      | 1 / 1.5 / 2.5 | multiplier                  | `R-MAP-06`    | Plains / hills / mountains                  |
| `B-DEFENSE-DENSITY`  |           1.0 | defender troops/tile weight | `R-ATTACK-03` | Cost of a tile grows with defender density  |
| `B-ATTACK-SPEED`     |             8 | divisor                     | `R-ATTACK-03` | Tiles taken per tick: 1 + isqrt(troops) / 8 |
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

Each value is given for easy / normal / hard (`R-BOT-04`).

| Key                  |           Value | Unit                         | Used by    | Notes                                                                                                                                          |
| -------------------- | --------------: | ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `B-BOT-INTERVAL`     |       4 / 2 / 1 | s between decisions          | `R-BOT-01` | Bots spread their decisions over the interval                                                                                                  |
| `B-BOT-ATTACK-RATIO` |    20 / 30 / 40 | % of troops at home          | `R-BOT-01` | Sent by one expansion or attack order                                                                                                          |
| `B-BOT-RESERVE`      |    50 / 35 / 20 | % of population cap          | `R-BOT-01` | Never sent; kept at home to defend                                                                                                             |
| `B-BOT-BOLDNESS`     | 100 / 125 / 150 | % of the bot's troop density | `R-BOT-01` | Attacks a neighbour at most this dense; half while land is free. Equal density is worth attacking: spent troops grow back, captured land stays |

## Victory

| Key           | Value | Unit              | Used by    | Notes |
| ------------- | ----: | ----------------- | ---------- | ----- |
| `B-WIN-SHARE` |    75 | % of ownable land | `R-WIN-01` |       |
