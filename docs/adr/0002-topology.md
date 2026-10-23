# 0002 · Topology

Status: Accepted · Date: 2026-10-23

## Context

Phase 1 plays on flat maps, some of which wrap east to west. Phase 2 plays the same game on a globe. If code everywhere computes neighbours as `index ± 1` and distances as differences of coordinates, the move to the globe means finding and fixing every one of those places, and every place that forgets the east-west seam is a bug.

## Decision

All geometry goes through a `Topology` interface, owned by the engine. Nothing else may compute tile coordinates, neighbours or distances by hand.

```ts
interface Topology {
  readonly size: number; // number of tiles; a tile is an integer in [0, size)
  readonly width: number;
  readonly height: number;
  readonly wrapsX: boolean; // whether east of the last column is the first one
  x(tile: number): number;
  y(tile: number): number;
  index(x: number, y: number): number; // any column is accepted on a wrapping map
  neighbors(tile: number): readonly number[]; // north, east, west, south
  neighborsInto(tile: number, out: Int32Array): number; // allocation-free, returns the count
  distance(a: number, b: number): number; // integer, shortest way round
  tilesWithin(center: number, radius: number): readonly number[]; // in row order
  toLatLon(tile: number): { lat: number; lon: number }; // for rendering only
}
```

Two implementations exist from the first version:

- `flat`: a rectangle with four edges.
- `cylinder`: the east-west seam is invisible; north and south are edges.

`WorldGrid` implements both, chosen by its `wrapsX` option (cylinder by default).

Pathfinding, spatial indexes and radius queries are built on the interface, never on raw coordinates. Tests for each geometric rule run against both implementations.

## Consequences

- Maps that wrap are not a special case. Every feature works across the seam the day it is written, or its tests fail.
- The globe can later bring its own `Topology` (an equirectangular grid with polar caps first, a cube-sphere grid only if play requires it) without changing the rules.
- Calls go through an interface in the hottest loops of the engine. `neighborsInto` avoids allocations there; profiling decides whether more is needed.
- `toLatLon` is the only bridge to the renderer, which keeps projections out of the engine.
