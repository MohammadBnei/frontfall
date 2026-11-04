import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "../src/origin.ts";

describe("isAllowedOrigin", () => {
  it("accepts everything when no origin is configured", () => {
    expect(isAllowedOrigin(undefined, undefined)).toBe(true);
    expect(isAllowedOrigin("https://example.com", "")).toBe(true);
  });

  it("accepts only the configured origin", () => {
    expect(isAllowedOrigin("https://nclsmgr.com", "https://nclsmgr.com")).toBe(true);
    expect(isAllowedOrigin("https://evil.example", "https://nclsmgr.com")).toBe(false);
  });

  it("lets clients without an Origin header through, since only browsers send one", () => {
    expect(isAllowedOrigin(undefined, "https://nclsmgr.com")).toBe(true);
  });

  it("accepts any of several origins separated by commas", () => {
    const allowed = "https://nclsmgr.com, https://www.nclsmgr.com";
    expect(isAllowedOrigin("https://www.nclsmgr.com", allowed)).toBe(true);
    expect(isAllowedOrigin("https://nclsmgr.com", allowed)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", allowed)).toBe(false);
    expect(isAllowedOrigin("https://evil.example", " , ")).toBe(true);
  });
});
