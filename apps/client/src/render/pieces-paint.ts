import { BUILDING_KINDS, GRID, pictogram, type BuildingKind, type Level } from "./pieces-geo.ts";

/**
 * The map markers of the nine buildings (docs/art-direction.md, piece
 * geometry), painted once into an atlas when the game starts: a dark
 * see-through disc with the white pictogram, ringed and haloed in the owner's
 * colour. The pixels hold shares, not colours, so one atlas serves every
 * player: red is the white of the pictogram, green the owner's colour, the
 * rest of the coverage (alpha) the dark of the disc; all three premultiplied.
 */

/** Pixels of one cell of the atlas: one building at one level of detail. */
export const CELL = 128;
/** One column for each level of detail. */
export const COLUMNS = 2;
export const ROWS = BUILDING_KINDS.length;
/** Units across a cell, the marker's centre in the middle; the piece itself is 100 units wide. */
export const SPAN = 120;

/** Radius of the disc, in units of the 100-unit piece; the ring is centred on its edge. */
export const DISC = 42;
/** The ring is thicker where the marker is small, so it stays a clear line of colour. */
const RING: Record<Level, number> = { 0: 7, 1: 5 };
/** Width of the halo outside the ring, and of the dark line between the two. */
const HALO = 11;
const RIM = 1.6;
/** Units per unit of the pictogram's grid. */
export const GLYPH = 2.15;

/** The pictogram and the owner's colour are painted as pure red and green, so each channel is its share. */
const WHITE = "#f00";
const OWN = (alpha: number): string => `rgba(0,255,0,${String(alpha)})`;

function circle(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
}

/** Fills the band between two radii. */
function band(
  ctx: CanvasRenderingContext2D,
  inner: number,
  outer: number,
  style: string | CanvasGradient,
): void {
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.arc(0, 0, outer, 0, Math.PI * 2);
  ctx.arc(0, 0, inner, 0, Math.PI * 2, true);
  ctx.fill();
}

/** The pictogram in white, its cut-outs cleared, on its own canvas so they show the disc. */
function glyph(canvas: HTMLCanvasElement, kind: BuildingKind, level: Level): HTMLCanvasElement {
  const g = canvas.getContext("2d");
  if (!g) throw new Error("no 2D canvas for the pieces");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, CELL, CELL);
  const k = (CELL / SPAN) * GLYPH;
  g.setTransform(k, 0, 0, k, CELL / 2 - (GRID / 2) * k, CELL / 2 - (GRID / 2) * k);
  g.fillStyle = WHITE;
  for (const shape of pictogram(kind, level)) {
    g.globalCompositeOperation = shape.cut ? "destination-out" : "source-over";
    g.beginPath();
    shape.points.forEach(([x, y], i) => {
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.closePath();
    g.fill();
  }
  g.globalCompositeOperation = "source-over";
  return canvas;
}

/** One marker, centred on the origin, in units of the 100-unit piece. */
function marker(
  ctx: CanvasRenderingContext2D,
  scratch: HTMLCanvasElement,
  kind: BuildingKind,
  level: Level,
): void {
  const ring = RING[level];
  const outer = DISC + ring / 2;
  // The halo in the owner's colour, fading outwards past a thin dark line that keeps the ring apart from land of its hue.
  const halo = ctx.createRadialGradient(0, 0, outer + RIM, 0, 0, outer + RIM + HALO);
  halo.addColorStop(0, OWN(0.5));
  halo.addColorStop(0.45, OWN(0.18));
  halo.addColorStop(1, OWN(0));
  band(ctx, outer + RIM, outer + RIM + HALO, halo);
  band(ctx, outer - 0.5, outer + RIM, "rgba(0,0,0,0.6)");
  // The disc: dark, a little see-through.
  ctx.fillStyle = "rgba(0,0,0,0.84)";
  circle(ctx, DISC);
  ctx.fill();
  ctx.save();
  circle(ctx, DISC - ring / 2);
  ctx.clip();
  ctx.drawImage(glyph(scratch, kind, level), -SPAN / 2, -SPAN / 2, SPAN, SPAN);
  ctx.restore();
  ctx.lineWidth = ring;
  ctx.strokeStyle = OWN(1);
  circle(ctx, DISC);
  ctx.stroke();
}

/**
 * The atlas: a cell per kind (rows) and level of detail (columns), as
 * premultiplied shares: red the white pictogram, green the owner's colour,
 * alpha the coverage, the dark of the disc being what the two leave of it.
 */
export function paintAtlas(): { data: Uint8Array; width: number; height: number } {
  const canvas = document.createElement("canvas");
  canvas.width = COLUMNS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2D canvas for the pieces");
  const scratch = document.createElement("canvas");
  scratch.width = CELL;
  scratch.height = CELL;
  const k = CELL / SPAN;
  BUILDING_KINDS.forEach((kind, row) => {
    for (let level = 0; level < COLUMNS; level++) {
      ctx.save();
      ctx.translate((level + 0.5) * CELL, (row + 0.5) * CELL);
      ctx.scale(k, k);
      marker(ctx, scratch, kind, level as Level);
      ctx.restore();
    }
  });
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const data = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = (pixels[i + 3] ?? 0) / 255;
    data[i] = Math.round((pixels[i] ?? 0) * alpha);
    data[i + 1] = Math.round((pixels[i + 1] ?? 0) * alpha);
    data[i + 3] = pixels[i + 3] ?? 0;
  }
  return { data, width: canvas.width, height: canvas.height };
}
