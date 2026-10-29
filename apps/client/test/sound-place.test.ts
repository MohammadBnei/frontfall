import { describe, expect, it } from "vitest";
import { altitude, placeFor } from "../src/audio/place.ts";

const view = { width: 1000, height: 600, scale: 20 };

describe("where a sound is heard from", () => {
  it("is clear and centred in the middle of the screen", () => {
    const place = placeFor({ ...view, x: 500, y: 300 }, false);
    expect(place.pan).toBeCloseTo(0);
    expect(place.gain).toBeGreaterThan(0.95);
    expect(place.cutoff).toBeGreaterThan(15000);
  });

  it("goes to the side it comes from", () => {
    expect(placeFor({ ...view, x: 900, y: 300 }, false).pan).toBeGreaterThan(0.5);
    expect(placeFor({ ...view, x: 100, y: 300 }, false).pan).toBeLessThan(-0.5);
  });

  it("gets quieter, duller and wetter the further off screen it lies", () => {
    const near = placeFor({ ...view, x: 1100, y: 300 }, false);
    const far = placeFor({ ...view, x: 4000, y: 300 }, false);
    expect(far.gain).toBeLessThan(near.gain);
    expect(far.cutoff).toBeLessThan(near.cutoff);
    expect(far.wet).toBeGreaterThan(near.wet);
  });

  it("keeps the player's own doing audible wherever it is", () => {
    expect(placeFor({ ...view, x: 9000, y: 300 }, true).gain).toBeGreaterThanOrEqual(0.75);
  });

  it("sounds softer and more diffuse from high above the map", () => {
    expect(altitude(1)).toBe(1);
    expect(altitude(16)).toBe(0);
    const high = placeFor({ ...view, scale: 1, x: 500, y: 300 }, false);
    const close = placeFor({ ...view, scale: 40, x: 500, y: 300 }, false);
    expect(high.gain).toBeLessThan(close.gain);
    expect(high.wet).toBeGreaterThan(close.wet);
  });

  it("falls back to the screen's own place before the view has a size", () => {
    const place = placeFor({ x: 10, y: 10, width: 0, height: 0, scale: 5 }, false);
    expect(Number.isFinite(place.pan + place.gain + place.cutoff + place.wet)).toBe(true);
    expect(placeFor({ x: Number.NaN, y: 1, width: 100, height: 100, scale: 5 }, true).pan).toBe(0);
  });

  it("loses its side far beyond the edge, as behind the globe", () => {
    expect(Math.abs(placeFor({ ...view, x: -1e6, y: -1e6 }, false).pan)).toBeLessThan(0.4);
  });
});
