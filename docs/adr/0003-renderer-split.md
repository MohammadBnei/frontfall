# 0003 · Renderer split

Status: Accepted · Date: 2026-10-23

## Context

The first renderer draws a flat map with Three.js under an orthographic camera. The globe of phase 2 is a different scene with a different camera. The simulation must stay identical between the two, and must be testable without a browser.

## Decision

- `packages/engine` never imports from the client or any rendering library. A dependency test fails the build if it does.
- The client reads the engine's state and draws it through two contracts:
  - `Renderer`: receives the territory and units that changed since the last frame and draws them. A flat-map renderer and a globe renderer implement it.
  - `Camera`: turns screen positions into tiles and back, pans and zooms. Each renderer brings its own; the interface and input handling do not know which one is active.
- Territory is drawn from a data texture indexed by tile, updated in place for the rows that changed, so both renderers share the same data and shaders differ only in projection.
- The simulation runs in a Web Worker; the render loop never waits for it.

## Consequences

- The same game can be shown flat or on a globe, and a player could switch between them in a running game.
- Engine tests run in Node, fast, without WebGL.
- Picking (which tile is under the cursor) belongs to the camera, which keeps the interface code free of projection maths.
- One more boundary to maintain: changes visible on the map need an engine change and a renderer change, reviewed together.
