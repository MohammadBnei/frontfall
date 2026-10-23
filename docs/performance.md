# Performance

Frontfall has to simulate a 4096 × 2048 world ten times per second on every
client and draw it smoothly in a browser, phones included. This document sets
the budgets the code is held to, explains the data layout that keeps the
simulation inside them, and records what was actually measured. Every number
in the results section comes from the benchmark scripts in [`bench/`](../bench),
not from estimates.

## Budgets

| Area                             | Budget                                   | Why                                                         |
| -------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| Simulation tick, largest map     | p95 ≤ 30 ms                              | 10 ticks/s leaves 100 ms; the rest goes to rules and AI     |
| Simulation memory, largest map   | ≤ 96 MiB of typed arrays                 | Runs in a Web Worker next to the page on 4 GB phones        |
| Allocation per tick              | None in the hot loops once warm          | GC pauses show up as dropped ticks                          |
| Draw calls for map and units     | ≤ 10                                     | Draw call overhead dominates on mobile GPUs                 |
| Frame time, desktop GPU          | ≤ 16.7 ms (60 fps)                       |                                                             |
| Frame time, mid-range phone      | ≤ 33 ms (30 fps)                         |                                                             |
| Territory upload per tick        | ≤ 1 MiB typical, full map only on resync | Uploads go through the browser's GPU process                |
| GPU memory for map and units     | ≤ 64 MiB at 4096 × 2048                  | Mobile browsers evict contexts well before the device limit |
| Main-thread CPU to issue a frame | ≤ 2 ms                                   | The page also runs input, UI and networking                 |

The reference machine for the simulation budget is whatever CI or a
contributor runs `pnpm bench` on; the results table names the machine used.

## Running the benchmarks

```sh
pnpm bench                      # simulation scenarios, about a minute
pnpm bench -- --quick           # a tenth of the ticks, for a quick check
pnpm bench -- --scenario reference --json results.json

pnpm bench:render               # renderer in headless Chromium (software GL)
pnpm bench:render -- --gpu      # same, on the machine's GPU
pnpm bench:render -- --serve    # serves the page on port 5180 to open by hand,
                                # for example on a phone on the same network
```

`pnpm bench` exits with a non-zero status when a scenario misses the tick
budget. `pnpm bench:render` needs a Chromium build: it uses Playwright's
browser if one is installed, or the one named by `CHROMIUM_PATH`.

Both use the same seeded workload, so two runs simulate exactly the same
game. The engine table prints a digest of the final owner array: if two runs
disagree on it, the simulation is no longer deterministic.

### The workload

There are no game rules yet, so [`bench/engine/workload.ts`](../bench/engine/workload.ts)
stands in for the expansion phase of a tick, using only engine data
structures. Every player picks random tiles of its front line and pushes
into a neighbouring land tile that it does not own, then the surroundings of
up to 64 freshly captured tiles are checked for enclosed pockets of at most
512 tiles, which are annexed. The map is 60 % land in 64 × 64 blocks with
noisy coasts. The access pattern (random border picks, ownership changes,
bounded fills) is the one the real rules will have; the numbers will be
measured again when they land.

| Scenario  | Map         | Players | Attempted captures/tick |
| --------- | ----------- | ------: | ----------------------: |
| reference | 4096 × 2048 |      64 |                   4,000 |
| crowded   | 4096 × 2048 |     512 |                   4,000 |
| assault   | 4096 × 2048 |      64 |                  20,000 |
| medium    | 2048 × 1024 |      32 |                   2,000 |

Each scenario runs untimed warm-up ticks first (300, or 100 for `assault`)
so territories and border lists reach a realistic size, then times 300 ticks.

## Simulation data layout

### Territory

[`TerritoryMap`](../packages/engine/src/territory/territory-map.ts) keeps
ownership in flat typed arrays indexed by tile:

| Array        | Type          |    Bytes per tile | Purpose                                                |
| ------------ | ------------- | ----------------: | ------------------------------------------------------ |
| `owners`     | `Uint16Array` |                 2 | Owner id, 0 for neutral; up to 65,535 players          |
| border slots | `Int32Array`  |                 4 | Position of the tile in its owner's border list, or -1 |
| border lists | `Int32Array`  | border tiles only | One unordered list per player                          |
| change log   | `Int32Array`  |    fixed, 256 KiB | Tiles changed since the renderer last looked           |

A border tile is an owned tile with at least one orthogonal neighbour held by
someone else, neutral included. When a tile changes hands, only that tile and
its four neighbours can gain or lose border status, so `setOwner` patches the
lists in constant time: removal swaps the last entry into the freed slot. The
list order depends only on the sequence of changes, so picking a border tile
by index with the seeded random generator stays deterministic across clients.

The change log lets the renderer, or the worker that forwards changes to it,
read what changed without diffing the map. When more tiles change than it
holds, it reports an overflow and the consumer redraws everything.

### Bounded flood fill

[`BoundedFloodFill`](../packages/engine/src/territory/bounded-flood-fill.ts)
answers questions such as "is this pocket enclosed?". Only small regions
matter, so the fill gives up as soon as it passes a tile limit instead of
walking the whole continent. Visited tiles are stamped with a generation
number (2 bytes per tile) rather than cleared, so starting a fill is free; the
queue grows to the largest limit used and is reused afterwards.

### Neighbours

`WorldGrid.neighbors()` returns a new array on every call, which is fine in
tests and tools but not in a loop that runs millions of times per second.
`WorldGrid.neighborsInto()` writes the same tiles, in the same order, into a
caller-owned `Int32Array`. Every hot path in the engine uses it, which keeps
the east-west wrap in one place.

## Rendering pipeline

### Territory layer

[`TerritoryLayer`](../apps/client/src/render/territory-layer.ts) draws the
whole map in one draw call:

- Owners are an `R16UI` integer texture whose data **is** the simulation's
  `Uint16Array`: no copy and no conversion on the CPU.
- Terrain is an `R8UI` texture uploaded once.
- A palette texture maps owner ids to colours, 256 entries per row.
- The fragment shader fetches the tile under the pixel with `texelFetch`,
  looks up its colour, and compares it with its four neighbours to draw
  borders. Borders therefore cost no upload at all.
- The mesh spans three copies of the world side by side and wraps columns in
  the shader. With the camera kept over the middle copy, the seam is never
  visible.

After each tick, the changed tiles mark their rows dirty in chunks of
`max(64, width / 32)` columns, and only those chunks are uploaded with
`texSubImage2D`, one call per run of dirty chunks in a row.

### Units

[`UnitLayer`](../apps/client/src/render/unit-layer.ts) draws every unit of one
kind with a single `InstancedMesh`. The vertex shader moves each instance to
the copy of the world nearest the camera, so units near the seam are not
duplicated. Only the span of instances changed since the last frame is
uploaded.

### Mobile compatibility

- WebGL 2 is required: integer textures, `texelFetch` and instancing are core
  features there, so no extension is needed. three.js no longer supports
  WebGL 1 anyway.
- WebGL 2 only guarantees 2048 texels per side. The largest map needs
  `MAX_TEXTURE_SIZE` ≥ 4096, which current phones report; on a device that
  does not, the owner texture has to be split in two halves, not yet done.
- The device pixel ratio should be capped at 2: a phone at ratio 3 shades
  2.25 times more pixels for no visible gain on a tile map.
- No float textures, no derivatives, no depth tricks: the shader only uses
  integer fetches and comparisons.

## Results

Measured on 2026-10-23 with Node 22.22.0 on a 4-core Intel Xeon at 2.10 GHz
(cloud VM, 16 GB), with `pnpm bench` and `pnpm bench:render`.

### Simulation

| Scenario  | Map       | Players | Tiles changed/tick | Tick p50 | Tick p95 | Tick max | Full rescan | Engine memory |
| --------- | --------- | ------: | -----------------: | -------: | -------: | -------: | ----------: | ------------: |
| reference | 4096×2048 |      64 |              1,625 |  2.77 ms |  3.52 ms | 13.62 ms |    39.84 ms |      72.6 MiB |
| crowded   | 4096×2048 |     512 |              2,676 |  3.64 ms |  5.74 ms | 12.59 ms |    47.37 ms |      73.2 MiB |
| assault   | 4096×2048 |      64 |              5,896 |  7.27 ms |  9.21 ms | 11.95 ms |    53.82 ms |      72.9 MiB |
| medium    | 2048×1024 |      32 |                739 |  2.29 ms |  3.90 ms |  5.87 ms |    10.73 ms |      18.4 MiB |

- Every scenario is within the 30 ms budget at p95, the heaviest by a factor
  of three. Ticks above p99 (up to 13.6 ms) happen while border lists grow;
  they are still inside the budget.
- Fewer tiles change than are attempted because many picks land on a coast or
  on a tile the player already owns, as they would in a real game.
- **Full rescan** is the time a naive tick would spend scanning every tile to
  find the front lines: 40 to 54 ms on the largest map, over the whole budget
  on its own. The incremental border lists are what make the budget reachable.
- Memory on the largest map: 48 MiB for ownership (6 bytes per tile),
  16 MiB for the flood fill stamps, 8 MiB for terrain, and the border lists
  for the rest. The JavaScript heap grows by less than 1 MiB per scenario.

### Rendering, software GL

Headless Chromium on SwiftShader, Google's CPU implementation of the GPU, on
the same machine. Frame times include waiting for the frame to finish.

| Map       | Viewport |  Units | Draw calls | Triangles | Frame p50 / p95  | Frame with a tick p50 / p95 | Uploaded per tick          | Full upload frame | GPU memory |
| --------- | -------- | -----: | ---------: | --------: | ---------------- | --------------------------- | -------------------------- | ----------------: | ---------: |
| 4096×2048 | 1280×720 | 10,000 |          2 |    80,002 | 182.9 / 209.8 ms | 191.3 / 217.5 ms            | 209,437 texels, 1,121 rows |          218.8 ms |   24.7 MiB |
| 2048×1024 | 1280×720 |  2,000 |          2 |    16,002 | 66.9 / 81.5 ms   | 67.6 / 81.1 ms              | 66,210 texels, 639 rows    |           67.1 ms |    6.1 MiB |
| 2048×1024 | 780×1688 |  2,000 |          2 |    16,002 | 68.3 / 79.2 ms   | 68.4 / 79.9 ms              | 66,210 texels, 639 rows    |           63.8 ms |    6.1 MiB |

What these numbers do show:

- The whole map plus 10,000 units costs **2 draw calls**, and issuing a frame
  takes 0.2 ms of main-thread CPU.
- A tick on the largest map uploads about 209,000 texels (0.4 MiB) instead of
  the 8.4 million of a full upload (16 MiB). An earlier version that uploaded
  one span per row, from the first to the last changed column, sent 670,518
  texels per tick in a quick run.
- GPU memory stays at a third of the budget on the largest map.

What they do not show is frame rate on a real GPU: SwiftShader rasterises on
the CPU, so absolute frame times are only useful to compare two versions of
the renderer on the same machine. A one-off quick run of the largest map with a
single unit instead of 10,000 took 26.3 ms per frame instead of 183 ms, so in
software almost all of the frame goes to the tiny unit triangles, which are
smaller than a pixel when the whole world is on screen. Frame rate budgets
will be checked with `pnpm bench:render -- --gpu` on a laptop and with
`--serve` on a phone; this section will be updated with those runs.

### Full game rules

`pnpm sim` plays a whole game with the real rules: a generated map of
2048×1024 tiles with several continents, scripted players that each send a
third of their troops every ten ticks, and `createGame` driven by a
`TurnClock`. It is the measure that counts once players touch: the synthetic
workload above has no attacks between players and no encirclement.

```sh
pnpm sim -- --width 2048 --height 1024 --players 16 --ticks 6000 --interval 10
pnpm sim -- --budget 30   # exits with an error when the tick p95 is over 30 ms
```

CI runs the 16-player game for 3,000 ticks on every push with `--budget 30`.

Measured on the same machine, before and after checking enclosures once per
attack and tick instead of once per captured tile:

| Players | Ticks          | Tick p50 | Tick p95 | Tick max | Before: p95 around tick 1,300 |
| ------: | -------------- | -------: | -------: | -------: | ----------------------------: |
|      16 | 4,663 (winner) |  2.36 ms |  7.61 ms | 31.36 ms |                             — |
|      64 | 3,000          |  6.95 ms | 25.32 ms | 44.09 ms |                     172.39 ms |

- With 64 players the worst stretch (ticks 1,500 to 1,900, over 100 attacks
  under way) runs at a p95 of 30 to 36 ms, just over budget. The time goes to
  finding each attack's front line (about half) and to enclosure fills (a
  quarter). v0.1 games have 8 to 16 players; 64 is the target of M7.

## Server load

The game server relays orders and closes one turn every 100 ms for every
game ([protocol](protocol.md)). [`bench/server`](../bench/server) checks that
it keeps that pace with many full games:

```sh
pnpm load -- --spawn-server                           # 20 games × 16 players, 30 min
pnpm load -- --spawn-server --games 20 --players 16 --minutes 2
pnpm load -- --games 20 --players 16 --minutes 30 --url ws://localhost:8080/ws
pnpm load -- --spawn-server --public --json load.json
```

Each simulated player speaks protocol v1 like the browser: one player per
game creates a private game, the others join it by id and the creator starts
it (`--public` uses matchmaking instead). Every player then sends an order
every 2 s on average (a spawn, then attacks on random tiles with random
troop counts) and a state hash every 50 ticks, and checks every turn it
receives. The report gives, per game:

- **Lateness**: the time between two consecutive turns on one client, minus
  the 100 ms tick. p50, p95 and max over every client of the game.
- **Order latency**: from sending an order to receiving the turn that holds
  it. Half a tick is expected on average, since an order waits for the next
  turn to close.
- Turns lost, reordered or desynced, which make the command exit with a
  non-zero status.

`--spawn-server` runs `createGameServer` in a child process, so its CPU time,
memory and event loop delay are measured apart from the clients'. Without
it, the tool connects to `--url`. Every client sends its own `X-Client-IP`
so that the per-address connection limit does not apply; behind a reverse
proxy that overwrites the header, the limit applies to the whole run.

All the clients run in one process. Its own event loop delay is printed: a
client process that falls behind shows up as lateness that the server did
not cause.

A 10-second run of 2 games of 8 players is part of `pnpm test`
([`bench/test/load.test.ts`](../bench/test/load.test.ts)): every client must
receive every turn in order, and the p95 interval must stay under 300 ms.

### Results

Measured on 2026-10-23 with Node 22.22.0 on the same 4-core Intel Xeon
Processor at 2.10 GHz (cloud VM, 16 GB) as above, with the server and the
320 clients on the same machine, using
`pnpm load -- --spawn-server --games 20 --players 16 --minutes <n>`.

| Run    | Games × players | Turns per client | Lost or reordered | Desyncs | Orders sent / seen | Interval p50 | p95      | p99      | max      | Order latency p50 / p95 / max |
| ------ | --------------- | ---------------: | ----------------: | ------: | -----------------: | -----------: | -------- | -------- | -------- | ----------------------------- |
| 2 min  | 20 × 16         |            1,197 |                 0 |       0 |    19,035 / 19,012 |     100.2 ms | 102.3 ms | 104.6 ms | 141.2 ms | 53.1 / 98.2 / 143.8 ms        |
| 30 min | 20 × 16         |  17,965 – 17,966 |                 0 |       0 |  287,733 / 287,726 |     100.2 ms | 102.4 ms | 105.3 ms | 321.7 ms | 53.0 / 98.1 / 277.5 ms        |

| Run    | Server CPU        | Server RSS        | Server loop delay p99 / max | Client loop delay p99 / max |
| ------ | ----------------- | ----------------- | --------------------------- | --------------------------- |
| 2 min  | 6.9 % of one core | 115 MiB, peak 135 | 4.0 / 53.6 ms               | 1.2 / 40.1 ms               |
| 30 min | 5.9 % of one core | 137 MiB, peak 137 | 4.0 / 74.9 ms               | 1.7 / 168.7 ms              |

- 320 players in 20 full games cost the server about 6 % of one core. Its
  RSS was 115 MiB after 2 minutes and 137 MiB after 30, against 108 MiB for
  a server with a single game of 2 players.
- Turns arrive at their pace: p95 lateness was +1.1 to +3.4 ms depending on
  the game, p99 at most +7 ms. Over 30 minutes no turn was lost, reordered
  or desynced, and every order sent was relayed (the few missing ones were
  in flight when the run stopped).
- The slowest interval, 321.7 ms, came with a 168.7 ms stall of the client
  process; the server's own event loop was never more than 74.9 ms late.
- The mean interval is 100.2 ms, not 100: the server's `setInterval` drifts,
  so a 30-minute game has 35 fewer turns (17,965) than 30 minutes of
  10 ticks/s. Clients follow the turns, not the clock, so this changes only
  the game's real duration.

### Fuzzing

[`apps/server/test/fuzz.test.ts`](../apps/server/test/fuzz.test.ts) feeds
100,000 random, truncated and mutated frames (text and binary, from valid
messages and from scratch) to the decoders in about 2.4 s on this machine, checking that they
never throw and that every accepted binary frame is the canonical encoding of
what it decodes to. It then opens about a thousand connections to a running
server, 1 to 6 frames each, until 4,000 more such frames are sent, checking that `/healthz` still
answers and that a game in progress on the same server keeps receiving its
turns every 100 ms. The generator is seeded; `FUZZ_SEED=<n> pnpm test` tries
other inputs.

It found one crash: a decoding error quotes the client's input, and a
non-ASCII quote could make the close reason longer than the 123 bytes a
WebSocket close frame allows, which made `ws` throw and stopped the whole
server. Reasons are now cut to 123 bytes.

## Next steps

1. Run the render benchmark on real GPUs (a Mac laptop, a mid-range Android
   phone, an iPhone) and fill in the frame-rate budgets.
2. Move the simulation into its Web Worker and send each tick's change log to
   the page as a transferable `Int32Array`. A `SharedArrayBuffer` would avoid
   even that copy, but needs cross-origin isolation headers on the server.
3. Wire `TerritoryLayer` and `UnitLayer` into the client in place of the
   current placeholder texture.
4. Hide units, or draw them as points, when they are smaller than a pixel.
5. Run `pnpm bench -- --quick` in CI and report the table on pull requests,
   without failing the build on noisy shared runners.
6. Bring 64-player games under budget: keep each attack's front line between
   ticks instead of rescanning the player's whole border, and share one border
   scan between the attacks of the same player.
7. Run `pnpm load` against the production deployment, behind its reverse
   proxy, from a machine other than the server's.
