import { describe, expect, it } from "vitest";
import { missingFeatures } from "../src/compat.ts";

describe("missingFeatures", () => {
  it("lists nothing for a browser that has everything", () => {
    expect(missingFeatures({ Worker: () => undefined, hasWebGL2: () => true })).toEqual([]);
  });

  it("names WebGL 2 and workers when they are missing", () => {
    expect(missingFeatures({ hasWebGL2: () => false })).toEqual(["webgl2", "worker"]);
    expect(missingFeatures({ Worker: () => undefined, hasWebGL2: () => false })).toEqual([
      "webgl2",
    ]);
    expect(missingFeatures({ hasWebGL2: () => true })).toEqual(["worker"]);
  });
});
