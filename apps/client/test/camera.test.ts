import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FlatCamera } from "../src/render/camera.ts";
import { applyView } from "../src/render/orthographic.ts";

const WIDTH = 512;
const HEIGHT = 256;

function camera(viewWidth = 1200, viewHeight = 800): FlatCamera {
  const flat = new FlatCamera({ width: WIDTH, height: HEIGHT });
  flat.resize(viewWidth, viewHeight);
  return flat;
}

const tile = (x: number, y: number): number => y * WIDTH + x;

/** Tiles in every corner, along the seam and in the middle. */
const SAMPLES = [
  tile(0, 0),
  tile(WIDTH - 1, 0),
  tile(0, HEIGHT - 1),
  tile(WIDTH - 1, HEIGHT - 1),
  tile(1, 100),
  tile(WIDTH - 2, 100),
  tile(255, 128),
  tile(300, 17),
];

describe("FlatCamera", () => {
  it("rejects a map without tiles and an empty zoom range", () => {
    expect(() => new FlatCamera({ width: 0, height: 4 })).toThrow(RangeError);
    expect(() => new FlatCamera({ width: 4, height: 4, minZoom: 4, maxZoom: 2 })).toThrow(
      RangeError,
    );
  });

  it("fits the whole map height at zoom 1", () => {
    const flat = camera();
    expect(flat.view()).toEqual({ centerX: 256, centerY: 128, halfWidth: 192, halfHeight: 128 });
    expect(flat.screenToTile(600, 400)).toBe(tile(256, 128));
    expect(flat.screenToTile(600, -1)).toBeUndefined();
    expect(flat.screenToTile(600, 800)).toBeUndefined();
  });

  it.each([1, 1.7, 4, 13, 32])("round-trips tiles at zoom %d", (zoom) => {
    for (const focus of [tile(256, 128), tile(0, 60), tile(WIDTH - 1, 200)]) {
      const flat = camera();
      flat.zoomAt(zoom, 600, 400);
      flat.focus(focus);
      for (const t of SAMPLES) {
        const { x, y } = flat.tileToScreen(t);
        expect(flat.screenToTile(x, y)).toBe(t);
      }
    }
  });

  it("zooms while focusing when asked, within the zoom range", () => {
    const flat = camera();
    flat.focus(tile(100, 100), 8);
    expect(flat.zoom).toBe(8);
    expect(flat.screenToTile(600, 400)).toBe(tile(100, 100));
    flat.focus(tile(100, 100), 1000);
    expect(flat.zoom).toBe(flat.maxZoom);
  });

  it("draws tiles across the seam next to the view, not a world away", () => {
    const flat = camera();
    flat.zoomAt(8, 600, 400);
    flat.focus(tile(0, 128));
    const east = flat.tileToScreen(tile(1, 128));
    const west = flat.tileToScreen(tile(WIDTH - 1, 128));
    expect(east.x - west.x).toBeCloseTo(2 * flat.scale);
    expect(flat.screenToTile(west.x - flat.scale, west.y)).toBe(tile(WIDTH - 2, 128));
  });

  it("wraps east-west when panning past the seam", () => {
    const flat = camera();
    flat.panBy(-WIDTH * flat.scale * 2.5, 0);
    expect(flat.view().centerX).toBeCloseTo(0);
    flat.panBy(flat.scale * 10, 0);
    expect(flat.view().centerX).toBeCloseTo(WIDTH - 10);
  });

  describe("on a flat map", () => {
    // At zoom 1 the map is 1600 pixels wide: narrower than a 2000-pixel screen.
    const flatMap = (viewWidth = 2000): FlatCamera => {
      const flat = new FlatCamera({ width: WIDTH, height: HEIGHT, wrapsX: false });
      flat.resize(viewWidth, 800);
      return flat;
    };

    it("centres a map narrower than the screen and never pans it", () => {
      const flat = flatMap();
      flat.panBy(400, 0);
      expect(flat.view().centerX).toBe(WIDTH / 2);
    });

    it("stops at the east and west edges once zoomed in", () => {
      const flat = flatMap();
      flat.zoomAt(4, 1000, 400);
      const { halfWidth } = flat.view();
      flat.panBy(WIDTH * flat.scale, 0);
      expect(flat.view().centerX).toBeCloseTo(halfWidth);
      flat.panBy(-WIDTH * flat.scale * 3, 0);
      expect(flat.view().centerX).toBeCloseTo(WIDTH - halfWidth);
    });

    it("has no tile beyond its edges and draws each tile once", () => {
      const flat = flatMap();
      expect(flat.screenToTile(100, 400)).toBeUndefined();
      expect(flat.screenToTile(1900, 400)).toBeUndefined();
      expect(flat.screenToTile(1000, 400)).toBe(tile(WIDTH / 2, HEIGHT / 2));
      const west = flat.tileToScreen(tile(0, 128));
      const east = flat.tileToScreen(tile(WIDTH - 1, 128));
      expect(east.x - west.x).toBeCloseTo((WIDTH - 1) * flat.scale);
    });
  });

  it("keeps the tile under the cursor in place while zooming", () => {
    const flat = camera();
    const cursor = { x: 1000, y: 150 };
    const before = flat.screenToTile(cursor.x, cursor.y);
    for (const factor of [2, 3, 0.5, 1.4]) {
      flat.zoomAt(factor, cursor.x, cursor.y);
      expect(flat.screenToTile(cursor.x, cursor.y)).toBe(before);
    }
  });

  it("keeps the cursor anchored across the seam", () => {
    const flat = camera();
    flat.zoomAt(4, 600, 400);
    flat.focus(tile(2, 128));
    const before = flat.screenToTile(100, 400);
    expect(before).toBe(tile(WIDTH - 38, 128));
    flat.zoomAt(3, 100, 400);
    expect(flat.screenToTile(100, 400)).toBe(before);
  });

  it("clamps the zoom between its limits", () => {
    const flat = camera();
    flat.zoomAt(1000, 0, 0);
    expect(flat.zoom).toBe(32);
    flat.zoomAt(0.0001, 0, 0);
    expect(flat.zoom).toBe(1);
    flat.zoomAt(0, 0, 0);
    flat.zoomAt(Number.NaN, 0, 0);
    expect(flat.zoom).toBe(1);
  });

  it("never shows past the poles", () => {
    const flat = camera();
    flat.panBy(0, 500);
    expect(flat.view().centerY).toBe(128);
    flat.zoomAt(4, 600, 0);
    // Zooming on the top edge stays clamped: the north pole stays at the top.
    expect(flat.view().centerY).toBe(32);
    flat.panBy(0, 10_000);
    expect(flat.view().centerY).toBe(32);
    flat.panBy(0, -10_000);
    expect(flat.view().centerY).toBe(HEIGHT - 32);
    flat.focus(tile(10, 0));
    expect(flat.view().centerY).toBe(32);
    expect(flat.screenToTile(0, 0)).toBeDefined();
  });

  it("keeps centre and zoom on resize", () => {
    const flat = camera();
    flat.zoomAt(2, 600, 400);
    flat.focus(tile(100, 100));
    flat.resize(400, 400);
    expect(flat.view()).toMatchObject({ centerX: 100.5, centerY: 100.5, halfHeight: 64 });
    expect(flat.viewportWidth).toBe(400);
    expect(flat.screenToTile(200, 200)).toBe(tile(100, 100));
  });
});

describe("applyView", () => {
  it("places the orthographic camera over the middle copy, y pointing north", () => {
    const flat = camera();
    flat.zoomAt(2, 600, 400);
    flat.focus(tile(0, 0));
    const ortho = new THREE.OrthographicCamera();
    applyView(ortho, flat.view(), WIDTH, HEIGHT);
    expect(ortho.position.x).toBeCloseTo(0.5 - WIDTH / 2);
    expect(ortho.position.y).toBeCloseTo(HEIGHT / 2 - 64);
    expect([ortho.left, ortho.right, ortho.top, ortho.bottom]).toEqual([-96, 96, 64, -64]);
  });
});
