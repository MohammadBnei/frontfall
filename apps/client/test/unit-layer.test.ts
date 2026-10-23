import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { UnitLayer } from "../src/render/unit-layer.ts";

describe("UnitLayer", () => {
  const create = (): UnitLayer => new UnitLayer({ worldWidth: 100, worldHeight: 50, capacity: 10 });

  it("places units at tile centres, north at the top", () => {
    const units = create();
    units.set(2, 10, 0, 0xff0000);
    const matrix = new THREE.Matrix4();
    units.mesh.getMatrixAt(2, matrix);
    const position = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect([position.x, position.y]).toEqual([10.5, 49.5]);
  });

  it("uploads only the span of units that moved", () => {
    const units = create();
    units.count = 10;
    units.set(3, 0, 0, 0xffffff);
    units.set(5, 0, 0, 0xffffff);
    expect(units.update(0)).toBe(3);
    expect(units.mesh.instanceMatrix.updateRanges).toEqual([{ start: 48, count: 48 }]);
    expect(units.mesh.instanceColor?.updateRanges).toEqual([{ start: 9, count: 9 }]);
    expect(units.update(0)).toBe(0);
  });

  it("bounds the number of units", () => {
    const units = create();
    units.count = 4;
    expect(units.count).toBe(4);
    expect(() => {
      units.count = 11;
    }).toThrow(RangeError);
    expect(() => {
      units.set(10, 0, 0, 0);
    }).toThrow(RangeError);
  });

  it("accounts for its GPU memory and is drawn in one call", () => {
    const units = create();
    expect(units.gpuBytes()).toBe(10 * 19 * 4);
    expect(units.mesh).toBeInstanceOf(THREE.InstancedMesh);
    units.dispose();
  });
});
