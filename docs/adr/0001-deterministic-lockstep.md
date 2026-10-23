# 0001 · Deterministic lockstep

Status: Accepted · Date: 2026-10-23

## Context

A game holds dozens of players and, with bots, hundreds of nations on maps of millions of tiles. Territory changes on thousands of tiles every second. Sending that state from a server to every player would cost more bandwidth than most connections have, and computing it for every running game would make hosting expensive.

## Decision

Every client runs the full simulation. The server never simulates: it collects each player's orders, closes them into a numbered turn every 100 ms (`TICK_RATE` = 10), and sends the same turns, in the same order, to every client of the game.

For identical turns to produce identical games on every device:

- The engine draws all randomness from a seeded generator (`Random`, xoshiro128\*\*), seeded by the server when the game starts.
- Game state is computed with integers. Floating-point values may be used for display only, never to decide an outcome.
- The engine never reads the clock, the device, or any API whose result varies across browsers. ESLint enforces this in `packages/engine` (`Math.random`, `Date`, `performance`, `crypto` and the transcendental `Math` functions are rejected), and the package compiles without DOM or Node types.
- The engine processes orders in turn order, then in the order the server listed them.
- Clients periodically send a hash of their game state. A mismatch identifies a desynchronised client, which is reported and reloaded from the turn log.

## Consequences

- Bandwidth is a few orders per player per second, whatever the map size. The server is a cheap relay that one small machine can run for many games.
- A late joiner or a reconnecting player replays the turn log from the start, so the engine must replay quickly.
- A cheater can read the whole game state, since every client has it. Hidden information is therefore excluded from the rules ([rules.md](../rules.md), `R-UNIT-01`).
- Determinism bugs are the costliest bugs this design can have. Engine pull requests need tests, and a replay test will compare state hashes across runs.
- Bots run in the engine as ordinary players issuing orders (`R-BOT-03`), so they cost the server nothing.
