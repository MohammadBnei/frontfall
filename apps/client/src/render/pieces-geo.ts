/**
 * The pictograms of the nine buildings the map draws (docs/art-direction.md,
 * piece geometry): one flat silhouette per kind, drawn once for the atlas
 * (pieces-paint.ts) and rasterised by the tests, so both read the same
 * drawing. Pure data, no canvas and no WebGL.
 *
 * Local space: a 32-unit grid, y down, the centre of the marker at (16, 16).
 */

export type BuildingKind =
  "city" | "palace" | "mosque" | "capital" | "fort" | "port" | "silo" | "airDefense" | "landmark";

export const BUILDING_KINDS: readonly BuildingKind[] = [
  "city",
  "palace",
  "mosque",
  "capital",
  "fort",
  "port",
  "silo",
  "airDefense",
  "landmark",
];

/** Detail level: 0 is the silhouette, kept at every size; 1 adds the small cut-outs from about 30 px. */
export type Level = 0 | 1;

export type Point = readonly [number, number];

/** A filled polygon, or one cut out of what is drawn before it. */
export interface Shape {
  readonly points: readonly Point[];
  readonly cut: boolean;
  readonly level: Level;
}

/** Side of the grid. */
export const GRID = 32;

/** Smallest on-screen size, in px, from which level 1 is drawn. */
export const LEVEL_FROM_PIXELS = 30;

/** The level of detail for a piece drawn `pixels` wide on screen. */
export const levelFor = (pixels: number): Level => (pixels < LEVEL_FROM_PIXELS ? 0 : 1);

/** How far past the threshold a piece must be to change level, as a share of it. */
const LEVEL_MARGIN = 0.1;

/**
 * The level a piece moves to from `current` as it is drawn `pixels` wide: it
 * keeps its level until clearly past the threshold, so a zoom that rests on it
 * does not make the details flicker.
 */
export function settleLevel(current: Level, pixels: number): Level {
  const wanted = levelFor(pixels);
  if (wanted === current) return current;
  const past = wanted > current ? 1 + LEVEL_MARGIN : 1 - LEVEL_MARGIN;
  return (
    wanted > current ? pixels >= LEVEL_FROM_PIXELS * past : pixels <= LEVEL_FROM_PIXELS * past
  )
    ? wanted
    : current;
}

function describe(kind: BuildingKind): Shape[] {
  const shapes: Shape[] = [];
  let cut = false;
  let level: Level = 0;
  const poly = (...points: Point[]): void => {
    shapes.push({ points, cut, level });
  };
  const rect = (x: number, y: number, w: number, h: number): void => {
    poly([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
  };
  /** Part of an ellipse from angle a0 to a1 (radians, y down), closed through its centre when `chord` is false. */
  const arc = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    a0 = 0,
    a1 = Math.PI * 2,
    chord = true,
  ): void => {
    const steps = Math.max(12, Math.round(Math.max(rx, ry) * 4 * ((a1 - a0) / Math.PI)));
    const points = Array.from({ length: steps + 1 }, (_, i): Point => {
      const a = a0 + ((a1 - a0) * i) / steps;
      return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
    });
    if (!chord) points.push([cx, cy]);
    shapes.push({ points, cut, level });
  };
  const circle = (cx: number, cy: number, r: number): void => {
    arc(cx, cy, r, r);
  };
  /** A dome standing on y = yb. */
  const dome = (cx: number, yb: number, rx: number, ry: number): void => {
    arc(cx, yb, rx, ry, Math.PI, Math.PI * 2);
  };
  /** A bar of width w from (x0, y0) to (x1, y1), ending in a point `tip` long. */
  const bar = (x0: number, y0: number, x1: number, y1: number, w: number, tip = 0): void => {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const [dx, dy] = [(x1 - x0) / length, (y1 - y0) / length];
    const [nx, ny] = [(-dy * w) / 2, (dx * w) / 2];
    poly(
      [x0 + nx, y0 + ny],
      [x1 + nx, y1 + ny],
      ...(tip > 0 ? [[x1 + dx * tip, y1 + dy * tip] as Point] : []),
      [x1 - nx, y1 - ny],
      [x0 - nx, y0 - ny],
    );
  };
  /** Cut-outs (`hole`) and details (`fine`) are what follows the call. */
  const mode = (hole: boolean, fine: Level = 0): void => {
    cut = hole;
    level = fine;
  };
  switch (kind) {
    case "city": {
      // A skyline climbing to one slender spire, then dropping to an annex: the only lopsided piece.
      rect(4, 20, 6.5, 7);
      rect(10.5, 11.5, 6, 15.5);
      rect(16.5, 5.5, 6, 21.5);
      poly([18, 5.5], [19.5, 1], [21, 5.5]);
      rect(22.5, 14.5, 5.5, 12.5);
      mode(true, 1);
      for (const [x0, y0, columns, rows] of [
        [5.4, 22, 2, 1],
        [11.6, 14.5, 2, 3],
        [17.6, 8.5, 2, 4],
        [23.6, 17.5, 2, 2],
      ] as const)
        for (let c = 0; c < columns; c++)
          for (let r = 0; r < rows; r++) rect(x0 + c * 2.4, y0 + r * 3.6, 1.5, 2);
      break;
    }
    case "palace": {
      // A wide body under a round dome and a spire, two low pavilions: symmetric and round-topped.
      rect(8, 20, 16, 7);
      rect(3.5, 18, 4.5, 9);
      rect(24, 18, 4.5, 9);
      dome(16, 20.5, 7.5, 8.5);
      poly([14.6, 13], [16, 5], [17.4, 13]);
      mode(true);
      rect(13.8, 23, 4.4, 4);
      arc(16, 23, 2.2, 2.2);
      mode(true, 1);
      rect(5, 20.5, 1.6, 3);
      rect(25.4, 20.5, 1.6, 3);
      rect(10, 22.5, 1.6, 3);
      rect(20.4, 22.5, 1.6, 3);
      break;
    }
    case "mosque": {
      // A hall under one plain dome and a finial between two tall minarets with pointed caps.
      rect(8.5, 20, 15, 7);
      dome(16, 20.5, 6.5, 7);
      rect(15.1, 10, 1.8, 4);
      circle(16, 9.2, 1.6);
      rect(3.5, 12, 3.8, 15);
      poly([3.2, 12.5], [5.4, 3.5], [7.6, 12.5]);
      rect(24.7, 12, 3.8, 15);
      poly([24.4, 12.5], [26.6, 3.5], [28.8, 12.5]);
      mode(true, 1);
      rect(14.4, 23.5, 3.2, 3.5);
      arc(16, 23.5, 1.6, 1.6);
      rect(4.6, 15, 1.6, 2.6);
      rect(25.8, 15, 1.6, 2.6);
      break;
    }
    case "capital": {
      // The crown: five points with balls on the tips, a band, jewels.
      poly([5, 22], [3.5, 9], [10, 15.5], [16, 6], [22, 15.5], [28.5, 9], [27, 22]);
      rect(5, 21, 22, 5.5);
      circle(3.5, 8.5, 2.2);
      circle(16, 5.5, 2.4);
      circle(28.5, 8.5, 2.2);
      mode(true);
      rect(5, 19.2, 22, 1.5);
      mode(true, 1);
      circle(10.5, 23.7, 1.3);
      circle(16, 23.7, 1.5);
      circle(21.5, 23.7, 1.3);
      break;
    }
    case "fort": {
      // A low, wide wall with no roof, coarse crenels and a gate.
      rect(4, 16, 24, 11);
      for (let i = 0; i < 5; i++) rect(4 + i * 5.1, 12, 3.6, 4.5);
      mode(true);
      rect(13, 20.5, 6, 6.5);
      arc(16, 20.5, 3, 3);
      mode(true, 1);
      rect(7, 19, 1.6, 3.4);
      rect(23.4, 19, 1.6, 3.4);
      break;
    }
    case "port": {
      // An anchor: a ring, a shank, a stock and two flukes.
      circle(16, 6.5, 3.4);
      rect(14.6, 9, 2.8, 17);
      rect(9.5, 12, 13, 2.8);
      arc(16, 16, 11, 11, 0.3, Math.PI - 0.3, false);
      poly([3.6, 18.5], [5.2, 13], [9.4, 17.5]);
      poly([28.4, 18.5], [26.8, 13], [22.6, 17.5]);
      mode(true);
      circle(16, 6.5, 1.5);
      arc(16, 16, 8.2, 8.2, 0, Math.PI, false);
      mode(false);
      rect(14.6, 16, 2.8, 10);
      break;
    }
    case "silo": {
      // A rocket standing upright on its pad, nose up, with two broad fins.
      poly([12.4, 23], [12.4, 10.5], [13.6, 5.5], [16, 1.5], [18.4, 5.5], [19.6, 10.5], [19.6, 23]);
      poly([12.4, 13.5], [7, 20], [7, 24], [12.4, 21]);
      poly([19.6, 13.5], [25, 20], [25, 24], [19.6, 21]);
      rect(4.5, 25, 23, 2.8);
      mode(true, 1);
      circle(16, 10, 1.5);
      rect(12.4, 16, 7.2, 1.3);
      break;
    }
    case "airDefense": {
      // Two launch tubes raised on a diagonal over a turret on a wide base.
      poly([4, 27], [6.5, 22], [25.5, 22], [28, 27]);
      dome(12.5, 22.5, 7, 6);
      bar(9, 19.5, 20.5, 8, 3.6, 2.6);
      bar(13.5, 23, 25, 11.5, 3.6, 2.6);
      mode(true, 1);
      rect(8, 24, 16, 1.2);
      break;
    }
    case "landmark": {
      // A pediment on four columns over two steps.
      poly([3.5, 11.5], [16, 4], [28.5, 11.5]);
      rect(4.5, 11.5, 23, 2.5);
      for (const x of [5.5, 11.2, 17.3, 23]) rect(x, 14, 3.5, 9.5);
      rect(4, 23.5, 24, 2);
      rect(3, 25.5, 26, 2);
      mode(true, 1);
      poly([13, 9.4], [16, 7.6], [19, 9.4]);
      break;
    }
  }
  return shapes;
}

const cache = new Map<BuildingKind, readonly Shape[]>();

/** The shapes of a pictogram drawn at `level`, in order: those kept at that level or a coarser one. */
export function pictogram(kind: BuildingKind, level: Level): readonly Shape[] {
  let shapes = cache.get(kind);
  if (!shapes) {
    shapes = describe(kind);
    cache.set(kind, shapes);
  }
  return shapes.filter((shape) => shape.level <= level);
}
