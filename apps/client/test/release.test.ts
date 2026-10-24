import { describe, expect, it } from "vitest";
import { isBeta } from "../src/release.ts";

describe("isBeta", () => {
  it("holds for every release before 1.0", () => {
    expect(isBeta("0.1.0")).toBe(true);
    expect(isBeta("0.9.12")).toBe(true);
  });

  it("ends at 1.0", () => {
    expect(isBeta("1.0.0")).toBe(false);
    expect(isBeta("2.3.0")).toBe(false);
  });
});
