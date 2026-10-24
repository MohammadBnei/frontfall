import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TerritoryLayer } from "../src/render/territory-layer.ts";

function layer(width = 256, height = 4, maxOwner = 3): TerritoryLayer {
  return new TerritoryLayer({
    width,
    height,
    owners: new Uint16Array(width * height),
    terrain: new Uint8Array(width * height),
    maxOwner,
  });
}

/** Update ranges as [row, first column, texel count]. */
function ranges(territory: TerritoryLayer): [number, number, number][] {
  const { width } = territory.options;
  return territory.ownerTexture.updateRanges.map(({ start, count }) => {
    const texel = start / 4;
    return [Math.floor(texel / width), texel % width, count / 4];
  });
}

describe("TerritoryLayer", () => {
  it("aliases the owner array instead of copying it", () => {
    const owners = new Uint16Array(8);
    const territory = new TerritoryLayer({
      width: 4,
      height: 2,
      owners,
      terrain: new Uint8Array(8),
      maxOwner: 1,
    });
    expect(territory.ownerTexture.image.data).toBe(owners);
  });

  it("uploads only the chunks that changed", () => {
    // 256 columns in 32 chunks of 64... rounded up to the 64-column minimum: 4 chunks.
    const territory = layer();
    territory.markChanged([3, 70, 256 * 2 + 255]);
    expect(territory.flush()).toBe(64 * 3);
    expect(ranges(territory)).toEqual([
      [0, 0, 128],
      [2, 192, 64],
    ]);
  });

  it("merges neighbouring dirty chunks of a row into one range", () => {
    const territory = layer();
    territory.markChanged([0, 64, 128, 255]);
    territory.flush();
    expect(ranges(territory)).toEqual([[0, 0, 256]]);
  });

  it("clips the last chunk to the map width", () => {
    const territory = layer(100, 2);
    territory.markChanged([99]);
    expect(territory.flush()).toBe(36);
    expect(ranges(territory)).toEqual([[0, 64, 36]]);
  });

  it("forgets changes once flushed", () => {
    const territory = layer();
    territory.markChanged([5]);
    territory.flush();
    territory.ownerTexture.clearUpdateRanges();
    expect(territory.flush()).toBe(0);
    expect(ranges(territory)).toEqual([]);
  });

  it("falls back to a full upload", () => {
    const territory = layer();
    territory.markChanged([5]);
    territory.markAllChanged();
    expect(territory.flush()).toBe(256 * 4);
    expect(territory.ownerTexture.updateRanges).toHaveLength(0);
  });

  it("stores owner colours in sRGB", () => {
    const territory = layer();
    territory.setOwnerColor(2, 0xff8000);
    const data = territory.paletteTexture.image.data as Uint8Array;
    expect(Array.from(data.subarray(8, 12))).toEqual([255, 128, 0, 255]);
    expect(() => {
      territory.setOwnerColor(0, 0);
    }).toThrow(RangeError);
    expect(() => {
      territory.setOwnerColor(4, 0);
    }).toThrow(RangeError);
  });

  it("sizes the palette to the number of owners", () => {
    expect(layer(4, 2, 255).paletteTexture.image.height).toBe(1);
    expect(layer(4, 2, 256).paletteTexture.image.height).toBe(2);
  });

  it("accounts for its GPU memory", () => {
    expect(layer(512, 256, 64).gpuBytes()).toBe(512 * 256 * 10 + 256 * 4);
  });

  it("draws the three copies of the world with one mesh", () => {
    const territory = layer(10, 4);
    territory.mesh.geometry.computeBoundingBox();
    const box = territory.mesh.geometry.boundingBox ?? new THREE.Box3();
    expect([box.min.x, box.max.x, box.min.y, box.max.y]).toEqual([-10, 20, 0, 4]);
    territory.dispose();
  });

  it("draws a flat map once", () => {
    const territory = new TerritoryLayer({
      width: 10,
      height: 4,
      owners: new Uint16Array(40),
      terrain: new Uint8Array(40),
      wrapsX: false,
      maxOwner: 1,
    });
    territory.mesh.geometry.computeBoundingBox();
    const box = territory.mesh.geometry.boundingBox ?? new THREE.Box3();
    expect([box.min.x, box.max.x]).toEqual([0, 10]);
    expect(territory.mesh.material.uniforms.wrapsX?.value).toBe(false);
    territory.dispose();
  });

  it("rejects arrays of the wrong size", () => {
    expect(
      () =>
        new TerritoryLayer({
          width: 4,
          height: 2,
          owners: new Uint16Array(7),
          terrain: new Uint8Array(8),
          maxOwner: 1,
        }),
    ).toThrow(RangeError);
  });
});
