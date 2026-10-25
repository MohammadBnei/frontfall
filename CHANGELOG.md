# Changelog

All notable changes to Frontfall are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-10-25

Deeper game, then sea and missiles, released together: cities and forts, alliances and betrayal, named nations, ports and trade, warships, missiles, team games, replays, gifts, quick messages and private-game options. Every rule of the v1 rulebook is in the game. There is no 0.3.0: v0.3 and v0.4 were checked and tagged as one release.

### Added

- Build cities and forts in a game: a panel above the toolbar, or C, F and X, picks what the next click builds or demolishes, with the cost of each and the cities your land supports. Structures show on the map, faded while being built.
- Engine: cities and forts ([docs/rules.md](docs/rules.md#6-structures)). Gold now buys structures: a city adds a twentieth of what the land holds to the population cap, a fort makes nearby land dearer to take and cheaper to lose, and both change hands with their tile. Players may own one city plus one more for every 10,000 tiles of land (40,000 on World), structures keep their distance, and bots build cities near their start. Protocol version 5 carries the new `build` and `demolish` orders.
- Ally and betray in a game: a right click, a long press or a leaderboard row opens a player's menu to ask for an alliance, accept, renew or betray. Requests wait under the banner with a countdown, allies are marked in the leaderboard and outlined on the map, and a feed tells everyone who allied and who betrayed whom.
- Engine: alliances and betrayal ([docs/rules.md](docs/rules.md#5-diplomacy)). Players ask each other for an alliance of 5 minutes, renewable in its last minute; allies cannot attack each other, and breaking an alliance marks the betrayer, whose land is half price for 30 seconds. Bots accept an alliance from a smaller player they are not fighting, one ally at most, and never betray.
- **Nations**: on the maps of the Earth and the quick maps, the countries of the map play from their capitals, under their own names ([docs/rules.md](docs/rules.md#8-bots-and-nations), `R-BOT-07` to `R-BOT-09`). A player who starts on a capital takes that nation's place. Nations hold their border under attack and answer the attacker alone, build a fort facing it, fight one player at a time and attack only when the odds favour them, until their army is full. A box in the menu and in the lobby turns them on or off; they are on by default, and the menu then suggests no bots. Protocol version 7 carries the choice in the game options, `lobby` and `started`; desync reports list the nations, and a golden replay plays World with them.
- The land under the mouse, or under a finger resting on a touch screen, lights up whole, and the edge of every attack under way marches with light and dark stripes, so fronts show on the map without the attack list. The stripes hold still for players who ask their system for reduced motion.
- **Replays**: the end screen saves the game as a `.ffr` file, and "Watch a replay" in the menu plays it again at ×1 to ×8, with no orders to give; at its end, the bar says whether it reached the same state as the game. A replay plays only on the build that recorded it ([docs/client.md](docs/client.md#replays)). Engine: `GameRecord`, `readGameRecord` and `replayGameRecord` ([docs/engine.md](docs/engine.md#game-records)).
- **Teams**: the menu and the lobby offer free-for-all or 2, 3 or 4 teams ([docs/rules.md](docs/rules.md#9-victory-and-game-modes), `R-MODE-02`). Players are dealt into teams in turn, teammates share shades of one colour and can never fight each other, and a team wins together at 75 % of the land. Protocol version 8 carries the choice in the game options, `lobby` and `started`; free-for-all games and their replays hash as before.
- **Ports and trade** ([docs/rules.md](docs/rules.md), `R-BUILD-02`, `R-UNIT-03`, `R-DIPLO-05`): a port (O, 100,000 gold) goes on your coast; every 10 seconds it sends a trade ship to a port of another player within 500 tiles of sea, and when it arrives both players earn 2,000 gold plus 20 per tile of the route. The player menu can put an embargo on a player's trade, which stops every ship between the two and is announced to all. Bots and nations build one port after their first city. Protocol version 9 carries the `embargo` order; the routes between ports are found once, when a port opens.
- **Warships** (`R-UNIT-04`): V, then a click on your port, buys a warship (250,000 gold, at most four); a click on water sends your closest one to patrol there. Warships fire only at the ships of players at war with you, meaning an attack or a landing between you in the last 30 seconds, or an embargo: an escort draws the fire away from a transport. Once an embargo between you has stood for 30 seconds, whoever placed it, a warship takes the other side's trade ships in range instead of a shot, one per second, with all the gold the ship would have paid; every player is told. Nations buy one per port while an enemy landing sails for their coast. Protocol version 10 carries the `warship` and `patrol` orders.
- **Missiles** (`R-BUILD-04`, `R-BUILD-05`, `R-UNIT-05`, `R-UNIT-06`): a missile silo (L, 800,000 gold) launches a missile (M, 300,000) or a heavy missile (N, 1,500,000) at any land whose blast spares allies and teammates, every 30 seconds. Where it strikes, the land goes back to nobody with its structures, and its owners lose the matching share of their troops; a heavy missile's blast is wider and leaves fallout that no one can take for a minute. An air defense (K, 1,000,000) stops three missiles out of four that fly near it, then reloads for 10 seconds. Nations build a silo once they have two cities, an air defense once someone else has a silo, and fire at their attacker or at a leader past 30 % of the land (`R-BOT-12`). Protocol version 11 carries the `missile` order.
- **Gifts** (`R-DIPLO-06`): the player menu sends the attack ratio's share of your troops or of your gold to anyone you are not at war with; they take only the troops their land has room for, and every player is told. Protocol version 12 carries the `gift` order.
- **Quick messages** (`R-DIPLO-07`): the player menu sends one of eight short messages or four emoji to a player, shown in the feed to the two of you only, one every 2 seconds at most. Protocol version 13 carries the `quick` order.
- **Leave things out of a private game** (`R-MODE-03`): the host unticks cities, forts, ports, missile silos, air defenses or warships in the lobby, and nobody, bots and nations included, can build or buy them. A link does the same with `?off=silo,warship`. Protocol version 12 carries the choice in the game options, `lobby` and `started`; desync reports and replays keep it.

### Changed

- Hard bots are stronger: they attack with more troops, keep fewer at home and take on denser neighbours ([docs/balance.md](docs/balance.md#bots)). Easy and normal bots play as before.
- CI holds the game to a performance budget ([docs/performance.md](docs/performance.md#budgets)). A new Performance job plays 64 bots on World on the commit and on the commit it branched from, alternating on the same runner, and fails when the engine got slower or its tick p95 exceeds 30 ms; it also fails when the client's download outgrows its budget, and reports load times and frame rate in headless Chromium. `pnpm perf:engine` and `pnpm perf:client` run the same checks locally.
- The panels over the map are opaque, so structures and ships no longer show through them. Ships keep a readable size when the map is zoomed out: trade ships and transports stay at least 6 pixels wide, warships 10, on the flat map and on the globe.
- The simulation worker is down from 50 kB to 23.5 kB gzipped: the schema library stays out of it.
- The client is versioned 0.4.0, and the beta label shows it.

### Fixed

- A refused build click no longer turns its build mode back on when the game answers it late, after a later click already built something.

## [0.2.0] - 2026-10-24

Online with friends: a player creates a private game from the menu, picks the map, the bots and their difficulty, and shares a link; every browser plays the same game in lockstep, and a desync is detected, reported and can be replayed. Eight maps, with the Panama and Suez canals open.

### Added

- **Online games in the browser**: the menu lists public games and opens private ones; the lobby shows the players, the countdown, the invitation link and the host's start button, and says when the page is outdated or a game expired. Every client runs the server's turns in its worker, with the bots the server asks for, and reports state hashes for desync detection ([docs/client.md](docs/client.md#playing-online)).
- Protocol version 3: the host of a private game picks the map, the number of bots and their difficulty (`configure`); the server accepts only published maps, and a small map or many bots leaves fewer seats. The `desync` message and log carry both hashes (protocol version 4).
- Online turns are evened out by a jitter buffer, so turns that the network bunches still play one per tick; a hidden tab keeps playing. Solo games run their turns down the same path.
- An online order keeps its ring on the map until the turn that carries it comes back from the server.
- A reload takes the online seat back: the tab rejoins the game, replays every turn and plays on with the others. Leaving from the menu gives the seat up.
- A desync offers a report to download. Engine: `DesyncReport` (version 1) holds the seed, map, balance, players, bots, turns and hashes of a game; `pnpm sim -- --replay report.json` plays one again and names the first tick where the client parted from the others ([docs/engine.md](docs/engine.md)).
- **Five more maps**: Americas, Africa and Asia from Natural Earth, and three small drawn maps, Island, Strait and Ring, for quick games and as test cases for a single landmass, a narrow strait and the east-west seam. The menu and the lobby list Earth maps and quick maps apart. The eight maps weigh under 400 kB compressed.
- Ships sail through the Panama and Suez canals on the World, Americas, Africa and Asia maps.
- Engine: golden replays of scripted games on Europe and World pin the state hash every 50 ticks; they run in Node with the tests and in Chromium and Firefox workers with `pnpm determinism`, and fail on the first tick that differs. The state hash now covers every balance value. `pnpm golden` writes them again after a change meant to alter games.
- End-to-end tests: a four-player private game without a desync, a reload during a game, and a forced desync whose downloaded report is replayed.

### Fixed

- Player colours show in the leaderboard and the lobby on servers whose content security policy forbids inline styles, as the public server does. The end-to-end tests run behind the same policy.

### Changed

- Nations on the continental maps start on their own continent and away from the map's edges.
- The server fits the seats of a private game to its map.
- The client is versioned 0.2.0, and the beta label shows it.

## [0.1.0] - 2026-10-24

The first playable beta: a solo game in the browser against bots on a map of the Earth or of Europe, with expansion, attacks, encirclement, retreat and ships across the sea, from the menu to the end screen. The relay server and protocol for online games are already in place.

### Added

- **Online games, protocol version 2** ([docs/protocol.md](docs/protocol.md)): a version handshake, binary frames for orders and turns, public games that start after a countdown or when full, private games joined by invitation link (`?game=<id>`), a list of public games at `/api/games`, reconnection with every missed turn, desync detection from client state hashes, and player name rules.
- Pages from an older build are asked to reload instead of joining a game they could desynchronise. Online games are played on the World map.
- Server protection and monitoring ([docs/server.md](docs/server.md)): a message rate limit per connection, idle connections closed, JSON logs that never record client addresses, and Prometheus metrics at `/metrics`, answered only to requests from the host.
- An operations runbook ([docs/operations.md](docs/operations.md)): logs, restart, rollback to a previous image and what to do after an uptime alert.
- `/healthz` answers `503` when the turn timer has stalled for 5 seconds or the server is shutting down, so an uptime check sees a server that accepts requests but no longer plays.
- The image caps the Node.js heap at 512 MiB, and `FRONTFALL_MAX_GAMES` and `FRONTFALL_MAX_CONNECTIONS` set the server's limits.
- Large static files, map files included, are served gzipped to browsers that accept it.
- Static files carry an `ETag`, so browsers revalidate maps and get `304 Not Modified` instead of downloading them again.
- Server limits: open connections in all, private games per address, orders per player per turn and the size of a game's turn log; a game not started within ten minutes ends with reason `expired`.
- Engine: the rules of a complete game of expansion, from `createGame`: `Topology` with flat and wrapping grids, exact integer arithmetic, the game state and its tick loop, validation of every order, the spawn phase, growth of troops and gold, expansion into unowned land, attacks between players, encirclement, retreat and victory ([docs/engine.md](docs/engine.md)).
- Engine: encirclement captures enclosed land of any player next to an attack's new tiles, not only of the player under attack, and also after expansion into unowned land (R-ATTACK-08). All fronts of a tick are planned before any attack moves.
- Engine: the population cap starts from the map's starting troops, so new and small players grow from the first tick (R-ECO-01). Bots of every difficulty are calmer: hard bots no longer wipe out a casual player within minutes on World.
- Engine: bots that have nothing left to take by land send transport ships to free or weaker land away from their own shore, with up to B-BOAT-MAX ships at sea (R-BOT-05). Large empires look at more of their border, so they no longer miss a narrow land front. A falloff of the population cap past a share of the map is available (R-ECO-06, off by default). A beachhead whose troops are still attacking is no longer captured by encirclement (R-ATTACK-08). Together these let a leader reach the 75 % win on World: between hard bots it now takes 7 to 8 minutes, where the leader used to stall around 62 %.
- Engine: only the pocket next to where an attack is aimed is spared from encirclement, so a token attack no longer shelters all of a player's land (R-ATTACK-08). Bots wait a few decisions before searching the sea again when it offered nothing, and no longer send a ship that cannot pay for a free beach.
- Engine: attacks spread as a wedge towards their aim instead of a thin line, and move twice as fast for the same cost (B-ATTACK-SPEED 4, B-ATTACK-SPREAD). Spawn spacing, radius and starting troops grow with the map (R-SPAWN-06).
- Engine: transport ships carry troops across the sea and land them on another coast, so players on different continents meet (`embark` order, R-UNIT-02).
- `pnpm determinism`, run in CI: the same bot game on World reaches the same state hash in Node and in a Chromium worker.
- Engine: `game.hash()`, a hash of the whole game state, pinned by a scripted test game.
- Engine: `TurnClock` closes turns from local orders for solo games and tests; `pnpm sim` plays a whole game headless and reports tick times.
- Project foundations: deterministic engine (seeded random generator, world grid that wraps east-west), turn relay server with lobbies, Three.js map view with endless east-west panning, CI, container image and automated deployment.
- Game rules specification ([docs/rules.md](docs/rules.md)) with rule identifiers, and starting balance values ([docs/balance.md](docs/balance.md)).
- Architecture decision records: deterministic lockstep, topology, renderer split, hosting under a sub-path.
- Clean-room policy and a CI job that compares every pull request with the reference codebase, by tokens for code and by hash for other files.
- End-to-end tests of the built game at `/` and under `/frontfall/`, run in CI and against the public server after each deployment.
- `/healthz` reports the running build in the `X-Frontfall-Version` header; the deployment waits for the new version to answer.
- Images are tagged with the version on `v*` tags.
- WebSocket connections are limited per player address, and the number of open games is capped.
- Pre-commit hook that formats and lints staged files.
- Map proposal issue form.
- **Maps from open data**: World (2048 × 1024, wraps east to west) and Europe (1280 × 1080), generated from Natural Earth by `pnpm maps` with coasts, relief, ocean depth, polar ice and 64 and 40 starting nations. The map format is specified in [docs/map-format.md](docs/map-format.md) and the generator in [docs/maps.md](docs/maps.md); the engine loads and verifies a map in about 30 ms.
- WebSocket protocol reference ([docs/protocol.md](docs/protocol.md)): connection URL, limits, and every message with an example.
- The interface is available in English and French, chosen from the browser's languages; the client can switch language without reloading ([docs/client.md](docs/client.md#translations)).
- The game says it is a beta, with its version, on the menu and during a game, until 1.0 ([docs/client.md](docs/client.md#beta)).
- **A new look for the map**: shaded relief, shallow and deep seas, surf along the coasts, crisp borders, tiles that fade in as fronts move, and player names with their troops on their land ([docs/client.md](docs/client.md#drawing-the-map)).
- Ships in the solo game: a click on a coast across the sea sends troops by ship, ships are drawn gliding at sea, and a click that sends nothing says why on the map ([docs/client.md](docs/client.md#controls)).
- Attacks under way are listed during a game, each with a Retreat button that calls it back ([docs/client.md](docs/client.md#controls)).
- The HUD states the win condition and shows how far the leader and the player are from it, with the time played.
- **Solo game in the browser**: a menu with map, bot count and difficulty, a game against bots run in a Web Worker, a HUD with troops, gold, land, attack ratio and leaderboard, pause, a help panel and an end screen ([docs/client.md](docs/client.md)).
- Engine: bots that expand into free land and attack their weakest neighbour, with three difficulty levels (`B-BOT-*` in [docs/balance.md](docs/balance.md)).
- Map controls: pan and zoom with the keyboard, zoom towards the cursor, pinch to zoom on touch screens, and a clear message when the browser cannot run WebGL 2.
- **The README is now the project's front page**, in English and French: brand banner, a Play now section, the milestone table, an architecture diagram, self-hosting and a four-step contribution guide. Bug and feature forms label new issues for triage.

### Changed

- The game stays in beta until v1.0, which is now the complete game on the 3D globe. The balanced flat-map version becomes v0.5, and the globe and performance milestones become v0.6 and v0.7.
- The roadmap now ships phase 1 as playable versions instead of milestones M1 to M5: v0.1 is a solo game against bots on a map of the Earth, v0.2 online games with friends, v0.3 structures, diplomacy and nations, v0.4 ships and missiles, then v1.0. Each version lists the checks that make it playable ([docs/roadmap.md](docs/roadmap.md)).
- The engine compiles without browser or Node types, and its lint rules also reject `Date`, `crypto` and floating-point `Math` functions whose results vary between browsers.
- Node.js 24 is required.
- Static files are served with cache headers: hashed assets are immutable, the page is revalidated.
- Desync detection compares every player's hash for the same tick and flags only those who differ from the majority, so one client cannot end a game for everyone with a false hash.
- The server trusts the `X-Client-IP` header only from a proxy on a private address, and accepts WebSocket connections without an `Origin` header, as sent by bots and tools.
- A client that cannot read a turn asks for a reload instead of playing on out of step, and one that notices a gap in its turns rejoins to fetch the missing ones.

[Unreleased]: https://github.com/nic0lasm/frontfall/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/nic0lasm/frontfall/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/nic0lasm/frontfall/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nic0lasm/frontfall/releases/tag/v0.1.0
