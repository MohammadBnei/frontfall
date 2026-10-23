# 0002 · Topology

Status: Accepted · Date: 2026-10-23

## Context

Phase 1 plays on flat maps, some of which wrap east to west. Phase 2 plays the same game on a globe. If code everywhere computes neighbours as `index ± 1` and distances as differences of coordinates, the move to the globe means finding and fixing every one of those places, and every place that forgets the east-west seam is a bug.

## Decision

All geometry goes through a `Topology` interface, owned by the engine. Nothing else may compute tile coordinates, neighbours or distances by hand.

```ts
interface Topology {
  readonly size: number; // number of tiles; a tile is an integer in [0, size)
  neighbors(tile: number): readonly number[];
  neighborsInto(tile: number, out: Int32Array): number; // allocation-free, returns the count
  distance(a: number, b: number): number; // integer, shortest way round
  tilesWithin(center: number, radius: number): Iterable<number>;
  toLatLon(tile: number): { lat: number; lon: number }; // for rendering only
}
```

Two implementations exist from the first version:

- `flat`: a rectangle with four edges.
- `cylinder`: the east-west seam is invisible; north and south are edges. Today's `WorldGrid` is this implementation and becomes it in M1.

Pathfinding, spatial indexes and radius queries are built on the interface, never on raw coordinates. Tests for each geometric rule run against both implementations.

## Consequences

- Maps that wrap are not a special case. Every feature works across the seam the day it is written, or its tests fail.
- The globe can later bring its own `Topology` (an equirectangular grid with polar caps first, a cube-sphere grid only if play requires it) without changing the rules.
- Calls go through an interface in the hottest loops of the engine. `neighborsInto` avoids allocations there; profiling decides whether more is needed.
- `toLatLon` is the only bridge to the renderer, which keeps projections out of the engine.
