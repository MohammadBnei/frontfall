import { surfacePoint, tileToLatLon } from "./globe-projection.ts";

type Vec3 = readonly [number, number, number];

/** A missile never rises higher than this above the surface, in planet radii. */
const LIFT_CAP = 0.08;
/** Share of the arc's angle the lift reaches at the top. */
const LIFT_RATIO = 0.16;

/**
 * Where a missile is on a globe: the great circle between its silo and its
 * target, lifted off the surface by an altitude that is 0 at both ends and
 * highest half way (the globe's version of missile-flight.ts, which lifts the
 * flat arc north). The route does not care for the antimeridian: it is the
 * short way around the planet, so a missile across the seam keeps one arc.
 * `from` and `to` are tiles, y counted from the north; `s` is 0 to 1. Returns a
 * point of space around the unit sphere: its direction is where the missile
 * is over the ground, its length 1 plus the altitude.
 */
export function flightPoint(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  s: number,
  width: number,
  height: number,
): Vec3 {
  const a = tilePoint(from, width, height);
  const b = tilePoint(to, width, height);
  const t = Math.min(1, Math.max(0, s));
  const cos = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const angle = Math.acos(cos);
  let p: Vec3;
  if (angle < 1e-4) {
    p = a;
  } else {
    const sin = Math.sin(angle);
    const wa = Math.sin((1 - t) * angle) / sin;
    const wb = Math.sin(t * angle) / sin;
    p = [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]];
  }
  const radius = 1 + Math.min(LIFT_RATIO * angle, LIFT_CAP) * 4 * t * (1 - t);
  return [p[0] * radius, p[1] * radius, p[2] * radius];
}

function tilePoint(
  tile: { readonly x: number; readonly y: number },
  width: number,
  height: number,
) {
  const { lat, lon } = tileToLatLon(tile.x + 0.5, tile.y + 0.5, width, height);
  return surfacePoint(lat, lon);
}
